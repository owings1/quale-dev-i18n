/**
 * @quale/dev-i18n
 *
 * Copyright (C) 2021 Doug Owings
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import {revalue} from '@quale/core/objects.js'
import {castToArray} from '@quale/core/types.js'
import {po as parser} from 'gettext-parser'

import Base from './base.js'
import {checkArg} from './util.js'
import {MissingContextError} from './errors.js'

import { fileURLToPath } from 'url'
import process from 'process'

/** Default Options **/
const Defaults = {
    logging: {
        styles: {
            info: {
                prefix: 'orange',
            },
            keywords: {
                msgid: {
                    default: 'green',
                },
            },
        },
    },
}

export default class Auditor extends Base {

    constructor(opts) {
        super(Defaults, opts)
    }

    getResults(globs) {
        const {logger} = this
        const files = this.glob(globs)
        if (files.length) {
            logger.info('Processing', files.length, 'files')
        } else {
            logger.warn('No files found')
        }
        return files.map(file => this.getResult(file))
    }

    getResult(file) {
        checkArg(file, 'file', 'string')
        const {logger} = this
        const {charset, context} = this.opts
        const rel = this.relPath(file)
        logger.info('Reading', {file: rel})
        const content = this.readFile(file)
        const po = parser.parse(content, charset)
        if (!po.translations[context]) {
            throw new MissingContextError(
                `Context '${context}' missing from po file ${rel}`
            )
        }
        const trans = Object.values(po.translations[context])
        const buckets = revalue(filters, () => [])
        const fentries = Object.entries(filters)
        trans.forEach(tran => {
            fentries.forEach(([key, filter]) => {
                if (filter(tran)) {
                    buckets[key].push(tran)
                }
            })
        })
        logger.info('Totals', revalue(buckets, bucket => bucket.length))
        return {file: rel, ...buckets}
    }

    logResults(results) {
        results = castToArray(results)
        const [allFull, hasUntrans] = arrayBisect(results, result =>
            result.untranslated.length
        )
        allFull.forEach(result => {
            const {file} = result
            log.info({file}, 'has no missing translations')
        })
        hasUntrans.sort((a, b) => b.untranslated.length - a.untranslated.length)
        hasUntrans.forEach(result => {
            const {file, untranslated} = result
            log.info({file}, 'has', untranslated.length, 'untranslated messages')
            untranslated.forEach(tran => {
                const {msgid} = tran
                log.print('   ', {msgid})
            })
        })
    }

    logResult(result) {
        return this.logResults(result)
    }
}

const filters = {
    untranslated: function ({msgid, msgstr}) {
        return msgid.length && !msgstr.some(str => str.length)
    },
}

function arrayBisect(arr, filter) {
    const result = [[], []]
    arr.forEach(value => {
        result[Number(Boolean(filter(value)))].push(value)
    })
    return result
}

function main(argv) {
    const usage = `Usage: node auditor.js [files,...]`
    const auditor = {logger: log} = new Auditor({
        logging: {
            //inspect: {depth: 4},
        }
    })
    if (!argv.length) {
        log.print(usage)
        return 0
    }
    try {
        run()
        return 0
    } catch (err) {
        log.error(err)
    }
    return 1
    function run() {
        const files = argv
        const results = auditor.getResults(files)
        auditor.logResults(results)
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main(process.argv.slice(2)))
}
