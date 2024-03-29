#!/usr/bin/env node
import {merge} from '@quale/term/merging.js'
import globby from 'globby'
import fs from 'fs'
import {basename, dirname, relative, resolve} from 'path'
import chproc from 'child_process'

import {gitFileStatus} from '../src/util.js'
import Base from './util/base.js'
import {ScriptError} from '../src/errors.js'

import { fileURLToPath } from 'url'
import process from 'process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const EgScript = 'example.js'
const Readme = 'README.md'
const GitStatusOk = ['clean', 'added', 'staged']

const ExamplesDir = resolve(__dirname, '../examples')
const TemplateFile = resolve(__dirname, 'res/example-template.md')

const PoBeginTag = '<po-content>'
const PoEndTag = '</po-content>'

export default class ExamplesScript extends Base {

    static flags() {
        return {
            quiet:  ['-q', '--quiet'],
            silent: ['-qq', '--silent'],
            noout:  ['-n', '--noout'],
            force:  ['-f', '--force'],
            print:  ['-p', '--print'],
            dryrun: ['-t', '--test', '--dryrun'],
        }
    }

    setup() {
        super.setup()
        const {opts, logger} = this
        if (opts.silent) {
            logger.logLevel = 0
        } else if (opts.quiet) {
            logger.logLevel = 1
        }
    }

    cmd_list() {
        const {logger, opts, args} = this
        const examples = this.listNames()
        logger.info('Found', examples.length, 'examples:')
        examples.forEach(name => logger.print('  -', name))
    }

    cmd_run() {
        const {logger, opts, args} = this
        let examples = this.listNames(args)
        logger.info('Processing', examples.length, 'examples')
        const sopts = {}
        if (!opts.noout) {
            sopts.stdio = 'inherit'
        }
        examples.forEach(example => {
            logger.info('Running', {example})
            this.runExample(example, sopts)
        })
        logger.info('Done')
    }

    cmd_build() {

        const {logger, opts, args} = this
        const template = this.readTemplate()
        const examples = this.listNames(args)

        logger.info('Processing', examples.length, 'examples')

        if (opts.force) {
            logger.warn('Skipping git checks with --force option')
        } else {
            logger.info('Checking clean file status')
            this.checkGit(examples)
            logger.info('Git check passed')
        }

        const outputs = {}

        const env = {
            PRETTY_FORCE_BEGINTAG : PoBeginTag,
            PRETTY_FORCE_ENDTAG   : PoEndTag,
            PRETTY_FORCE_INDENT   : '0',
            //PRETTY_FORCE_HRFIXED  : 'sakdfjhaklsdf',
        }
        const sopts = {env}

        examples.forEach(example => {
            logger.info('Running', {example})
            const {stdout} = this.runExample(example, sopts)
            outputs[example] = stdout.toString('utf-8')
            const method = opts.print ? 'info' : 'debug'
            logger[method]('Script output:\n' + outputs[example])
        })

        examples.forEach(example => {
            const file = resolve(ExamplesDir, example, Readme)
            const content = this.buildReadme(template, example, outputs[example])
            const method = opts.print ? 'info' : 'debug'
            logger[method]('Built readme:\n' + content)
            logger.info('Writing', relative(ExamplesDir, file))
            if (opts.dryrun) {
                logger.warn('Not writing in dryrun mode.')
            } else {
                fs.writeFileSync(file, content)
            }
        })

        logger.info('Done')
    }

    listNames(names) {
        const examples = globby.sync(ExamplesDir + '/*/' + EgScript)
            .map(file => basename(dirname(file)))
        if (!names || !names.length) {
            return examples
        }
        const invalid = names.filter(name => !examples.includes(name))
        if (invalid.length) {
            const estr = invalid.join(', ')
            throw new ScriptError(`Unknown example(s): ${estr}`)
        }
        return names
    }

    readTemplate() {
        return fs.readFileSync(TemplateFile, 'utf-8')
    }

    buildReadme(template, name, output) {
        const lines = []
        let isCodeOpen = false
        output.split('\n').forEach(line => {
            if (line === PoBeginTag) {
                if (isCodeOpen) {
                    lines.push('```')
                }
                lines.push('```po')
                isCodeOpen = true
                return
            }
            if (line === PoEndTag) {
                if (isCodeOpen) {
                    lines.push('```')
                    isCodeOpen = false
                }
                return
            }
            if (!isCodeOpen && line) {
                lines.push('```')
                isCodeOpen = true
                lines.push(line)
                return
            }
            lines.push(line)
        })
        if (isCodeOpen) {
            lines.push('```')
            isCodeOpen = false
        }
        const pre = lines.join('\n')
        return template.replace('{name}', name).replace('{output}', pre)
    }

    checkGit(examples) {
        const {logger} = this
        let dirty
        try {
            dirty = examples.map(example => {
                const file = resolve(ExamplesDir, example, Readme)
                const {fileStatus} = gitFileStatus(file)
                return [relative(ExamplesDir, file), fileStatus]
            }).filter(([file, status]) =>
                !GitStatusOk.includes(status)
            )
        } catch (err) {
            if (err.stderr) {
                logger.warn('stderr:\n' + err.stderr)
            }
            throw err
        }
        if (dirty.length) {
            dirty.forEach(([file, status]) => {
                logger.error('Dirty path:', {file}, {status})
            })
            throw new ScriptError('Git check failed')
        }
    }

    runExample(name, sopts = {}) {
        const {logger} = this
        sopts = merge(
            {
                // 10K max
                maxBuffer: 1024 * 10,
                env: process.env,
            },
            sopts,
        )
        const script = resolve(ExamplesDir, name, EgScript)
        const cmd = process.execPath
        const result = chproc.spawnSync(cmd, [script], sopts)
        if (result.error) {
            throw result.error
        }
        if (result.status != 0) {
            if (result.stderr) {
                logger.warn('stderr:\n' + result.stderr.toString('utf-8'))
            }
            throw new ScriptError(`Example exited with code ${result.status}`)
        }
        return result
    }
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
    new ExamplesScript(true, process.argv).run()
}
