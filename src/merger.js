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

import {buffersEqual} from '@quale/core/buffers.js'
import {rekey, revalue} from '@quale/core/objects.js'
import {castToArray, isFunction, isObject} from '@quale/core/types.js'
import {merge} from '@quale/term/merging.js'
import fse from 'fs-extra'
import {po as parser} from 'gettext-parser'

import fs from 'fs'
import path from 'path'

import Base from './base.js'
import Sort from './sorters.js'
import {checkArg, checkMax, gitFileStatus} from './util.js'

import {
    DuplicateKeyError,
    MissingContextError,
    UnsavedChangesError,
} from './errors.js'

// Default options.
const Defaults = {
    dryRun     : false,
    gitCheck   : true,
    replace    : false,
    sort       : 'source',
    forceSave  : false,
    references: {
        enabled    : true,
        max        : -1,
        perFile    : -1,
        perLine    : -1,
        lineLength : -1,
    },
    logging: {
        styles: {
            info: {
                prefix: 'magenta',
            },
        },
    },
}

const GitStatusOk = ['clean', 'added', 'staged']

export default class Merger extends Base {

    /**
     * @constructor
     * @throws {ArgumentError}
     * @param {object} opts The options
     */
    constructor(opts) {
        super(Defaults, opts)
        if (this.opts.references === true) {
            this.opts.references = {...Defaults.references}
        } else if (!isObject(this.opts.references)) {
            this.opts.references = {}
        }
        if (Boolean(process.env.DRY_RUN)) {
            this.opts.dryRun = true
        }
        checkSortOption(this.opts.sort)
    }

    /**
     * Update a po file with the extracted messages.
     *
     * @throws {ExecExitError}
     * @throws {ExecResultError}
     * @throws {TypeError}
     * @throws {UnsavedChangesError}
     *
     * @emits `beforeSave`
     *
     * @param {string} file The po file
     * @param {array} messages The messages
     * @return {object} The merge info result
     */
    mergePo(file, messages) {
        checkArg(
            file     , 'file'     , 'string',
            messages , 'messages' , 'array',
        )
        const {forceSave} = this.opts
        const rel = this.relPath(file)
        checkGitDirty.call(this, file)
        const result = this.getMergePoResult(file, messages)
        result.file = rel
        const {content, isChange, sourceContent} = result
        if (isChange || forceSave || !buffersEqual(content, sourceContent)) {
            this.emit('beforeSave', file, content)
            this.logger.info('Writing', {file: rel})
            writeFile.call(this, file, content)
        } else {
            this.logger.info('No changes to write', {file: rel})
        }
        return result
    }

    /**
     * Update po files with the extracted messages.
     *
     * @throws {ArgumentError}
     * @throws {ExecExitError}
     * @throws {ExecResultError}
     * @throws {TypeError}
     * @throws {UnsavedChangesError}
     *
     * @emits `beforeSave`
     *
     * @param {array|string} globs Po file path(s)/glob(s)
     * @param {array} messages The messages
     * @return {array} The merge info results
     */
    mergePos(globs, messages) {
        checkArg(
            messages , 'messages' , 'array',
        )
        const files = this.glob(globs)
        files.forEach(file => checkGitDirty.call(this, file))
        if (files.length) {
            this.logger.info('Updating', files.length, 'po files')
        } else {
            this.logger.warn('No po files found')
        }
        return files.map(file => this.mergePo(file, messages))
    }

    /**
     * Update a po file with the extracted messages.
     *
     * @throws {ExecExitError}
     * @throws {ExecResultError}
     * @throws {TypeError}
     * @throws {UnsavedChangesError}
     *
     * @emits `beforeSave`
     *
     * @param {string} sourceFile The source po file
     * @param {string} destFile The destination file
     * @param {array} messages The messages
     * @return {object} The merge info result
     */
    mergePoTo(sourceFile, destFile, messages) {
        checkArg(
            sourceFile , 'sourceFile' , 'string',
            destFile   , 'destFile'   , 'string',
            messages   , 'messages'   , 'array',
        )
        checkGitDirty.call(this, destFile)
        const rel = this.relPath(destFile)
        const result = this.getMergePoResult(sourceFile, messages)
        result.file = rel
        result.sourceFile = this.relPath(sourceFile)
        const {content} = result
        this.emit('beforeSave', destFile, content)
        this.logger.info('Writing', {file: rel})
        writeFile.call(this, destFile, content)
        return result
    }

    /**
     * Update a po files with the extracted messages.
     *
     * @throws {ArgumentError}
     * @throws {ExecExitError}
     * @throws {ExecResultError}
     * @throws {TypeError}
     * @throws {UnsavedChangesError}
     *
     * @emits `beforeSave`
     *
     * @param {array|string} sourceGlob Po file path(s)/glob(s)
     * @param {string} destDir The destination directory
     * @param {array} messages The messages
     * @return {array} The merge info results
     */
    mergePosTo(sourceGlob, destDir, messages) {
        checkArg(
            destDir , 'destDir' , 'string',
            messages, 'messages', 'array',
        )
        const sourceFiles = this.glob(sourceGlob)
        destDir = this.resolve(destDir)
        const destFiles = sourceFiles.map(file => {
            const relBase = this.relPath(file)
            const parts = relBase.split(path.sep)
            const relShort = parts.length > 1
                ? parts.slice(1).join(path.sep)
                : parts.join(path.sep)
            return path.resolve(destDir, relShort)
        })
        if (sourceFiles.length) {
            this.logger.info('Creating', sourceFiles.length, 'new po files')
        } else {
            this.logger.warn('No po files found')
        }
        destFiles.forEach(file => {
            fse.ensureDirSync(path.dirname(file))
            if (fs.existsSync(file)) {
                checkGitDirty.call(this, file)
            }
        })
        return sourceFiles.map((sourceFile, i) =>
            this.mergePoTo(sourceFile, destFiles[i], messages)
        )
    }

    /**
     * Get the result object for merging a po file.
     *
     * @throws {TypeError}
     *
     * @param {string} sourceFile The source po file
     * @param {array} messages The messages
     * @return {object} The merge info result
     */
    getMergePoResult(sourceFile, messages) {
        checkArg(
            sourceFile , 'sourceFile' , 'string',
            messages   , 'messages'   , 'array',
        )
        const {charset, replace} = this.opts
        const rel = this.relPath(sourceFile)
        const method = replace ? 'replace' : 'patch'
        this.logger.info('Reading', {file: rel})
        const sourceContent = this.readFile(sourceFile)
        const sourcePo = parser.parse(sourceContent, charset)
        const {pos, ...result} = mergePoResult.call(this, sourcePo, messages)
        const po = pos[method]
        const content = parser.compile(po)
        return {content, po, sourceContent, sourcePo, ...result}
    }

    /**
     * Returns a new object with keys sorted.
     *
     * @throws {TypeError}
     *
     * @param {object} translations The tranlations
     * @param {object} sourceOrderHash The source order hash from the original po file
     * @return {object} A new object with key insert order
     */
    sortedTranslations(translations, sourceOrderHash) {
        checkArg(
            translations    , 'translations'    , 'object',
            sourceOrderHash , 'sourceOrderHash' , 'object',
        )
        const sorter = getSorter.call(this, sourceOrderHash)
        const values = Object.values(translations).sort(sorter)
        return Object.fromEntries(values.map(tran => [tran.msgid, tran]))
    }
}

/**
 * Inspired by:
 *
 *    https://github.com/oliviertassinari/i18n-extract/blob/9110ba513/src/mergeMessagesWithPO.js
 *
 * @private
 *
 * @throws {DuplicateKeyError}
 * @throws {MissingContextError}
 * @throws {TypeError}
 *
 * @emits `added`
 * @emits `found`
 * @emits `changed`
 * @emits `missing`
 *
 * @param {object} po
 * @param {object} messages
 * @return {object}
 */
function mergePoResult(po, messages) {

    checkArg(
        po       , 'po'       , 'object',
        messages , 'messages' , 'array',
    )
    checkArg(
        po.translations , 'po.translations' , 'object',
        po.headers      , 'po.headers'      , 'object',
    )

    const {context} = this.opts

    if (!po.translations[context]) {
        throw new MissingContextError(
            `Context '${context}' missing from po.`
        )
    }

    const isRefs = this.opts.references.enabled
    const source = po.translations[context]
    const headersLc = rekey(po.headers, key => key.toLowerCase())

    this.logger.info('Processing po', {
        context,
        language     : headersLc.language || 'unknown',
        translations : Object.keys(source).length - ('' in source),
    })

    const track = {
        added   : {},
        found   : {},
        changed : {},
        missing : {},
    }
    const data = {
        patch   : {},
        replace : {},
    }

    messages.forEach(message => {

        const msgid = message.key

        this.logger.debug({msgid})

        if (msgid in data.patch) {
            throw new DuplicateKeyError(
                `Duplicate msgid: '${msgid}'. Collate the messages first.`
            )
        }

        const found = source[msgid]
        const tran = merge({msgid, msgstr: ['']}, found)
        const changes = []
        const info = {message, tran}

        this.verbose(2, {msgid, isFound: Boolean(found)})

        data.patch[msgid] = tran
        data.replace[msgid] = tran

        if (isRefs) {
            // Add file location reference comment.
            const refs = castToArray(message.refs)
            this.verbose(3, {refs})
            if (refs.length) {
                const refsChange = addReference(refs, tran, this.opts.references)
                if (found && refsChange) {
                    changes.push(refsChange)
                }
            } else {
                this.logger.warn(
                    `Missing location reference for '${msgid}'`
                )
            }
        }

        // Add extracted comments.
        const cmts = castToArray(message.comments)
        let cmtsChange
        if (cmts.length) {
            cmtsChange = addExtractedComment(cmts, tran)
        } else if (tran.comments && tran.comments.extracted) {
            cmtsChange = {
                'comments.extracted': {
                    old: tran.comments.extracted,
                    new: null,
                }
            }
            delete tran.comments.extracted
        }

        if (found) {
            if (cmtsChange) {
                changes.push(cmtsChange)
            }
            // Message exists in source po.
            track.found[msgid] = info
            this.verbose(2, 'found', {msgid})
            this.emit('found', tran, message)
            if (changes.length) {
                // Message was changed (comments).
                track.changed[msgid] = info
                info.changes = changes
                this.verbose(2, 'changes', changes)
                this.emit('changed', tran, message, changes)
            }
        } else {
            // Message does not exist in source po.
            track.added[msgid] = info
            if (context) {
                tran.msgctxt = context
            }
            this.verbose(1, 'added', {msgid})
            this.emit('added', tran, message)
        }
    })

    Object.values(source).forEach(tran => {
        const {msgid} = tran
        if (msgid && !data.patch[msgid]) {
            this.verbose(1, 'missing', {msgid})
            if (tran.comments) {
                // Clear extracted comments and references.
                delete tran.comments.extracted
                delete tran.comments.reference
            }
            track.missing[msgid] = {tran}
            data.patch[msgid] = tran
            this.emit('missing', tran)
        }
    })

    const counts = revalue(track, type => Object.values(type).length)
    const isChange = Boolean(counts.added + counts.missing + counts.changed)

    const sourceOrderHash = revalue(source, (tran, i) => i)
    const pos = revalue(data, trans => {
        const copy = {...po, translations: {...po.translations}}
        trans = this.sortedTranslations(trans, sourceOrderHash)
        copy.translations[context] = trans
        return copy
    })

    this.logger.info('Totals', counts)
    this.verbose(2, 'mergePoResult', {isChange})

    return {track, counts, isChange, pos}
}

/**
 * @private
 * @throws {ArgumentError}
 * @param {object} sourceOrderHash
 * @return {function}
 */
function getSorter(sourceOrderHash) {
    const {sort} = this.opts
    checkSortOption(sort)
    const that = {sourceOrderHash}
    if (isFunction(sort)) {
        this.verbose(2, 'sorting by custom function')
        return sort.bind(that)
    }
    this.verbose(2, `sorting by ${sort}`)
    return Sort.tran[sort].bind(that)
}

/**
 * @param {array} cmts
 * @param {object} tran
 * @return {object}
 */
function addExtractedComment(cmts, tran) {
    if (!tran.comments) {
        tran.comments = {}
    }
    const extracted = cmts.join('\n')
    let change = false
    if (tran.comments.extracted !== extracted) {
        change = {
            'comments.extracted': {
                old: tran.comments.extracted,
                new: extracted,
            }
        }
        tran.comments.extracted = extracted
    }
    return change
}
/**
 * @param {array} refs
 * @param {object} tran
 * @param {object} opts
 * @return {object|boolean}
 */
function addReference(refs, tran, opts) {
    if (!tran.comments) {
        tran.comments = {}
    }
    const reference = buildReference(refs, opts)
    let change = false
    if (tran.comments.reference !== reference) {
        change = {
            'comments.reference': {
                old: tran.comments.reference,
                new: reference,
            }
        }
        tran.comments.reference = reference
    }
    return change
}

/**
 * @param {array} refs
 * @param {object} opts
 * @return {array}
 */
function buildReference(refs, opts) {
    const counts = {}
    const built = []
    for (let i = 0; i < refs.length; ++i) {
        if (checkMax(built.length, opts.max)) {
            break
        }
        const ref = refs[i]
        const [file, line] = ref.split(':')
        if (!counts[file]) {
            counts[file] = 0
        }
        counts[file] += 1
        if (checkMax(counts[file], opts.perFile)) {
            continue
        }
        built.push(ref)
    }
    return buildReferenceLines(built, opts).join('\n')
}

/**
 * @param {array} built
 * @param {object} opts
 * @return {array}
 */
function buildReferenceLines(built, opts) {
    const lines = []
    let line = ''
    for (let i = 0, count = 0; i < built.length; ++i, ++count) {
        const ref = built[i]
        const isMax = checkMax(count + 1, opts.perLine) || (
            count > 0 &&
            checkMax(line.length + ref.length + 1, opts.lineLength)
        )
        if (isMax) {
            lines.push(line)
            line = ''
            count = 0
        }
        line += (count > 0 ? ' ' : '') + ref
    }
    if (line) {
        lines.push(line)
    }
    return lines
}

/**
 * @throws {ArgumentError}
 * @param {*} value
 */
function checkSortOption(value) {
    checkArg(
        value, 'opts.sort', it => (
            it == null || isFunction(it) || Sort.tran.hasOwnProperty(it)
        )
    )
}

/**
 * @private
 *
 * @throws {ExecExitError}
 * @throws {ExecResultError}
 * @throws {UnsavedChangesError}
 *
 * @param {string} file The file path
 */
function checkGitDirty(file) {
    const log = this.logger
    const {gitCheck} = this.opts
    const rel = this.relPath(file)
    this.verbose(1, 'gitCheck', {gitCheck}, {file: rel})
    if (!gitCheck) {
        return
    }
    let fileStatus
    try {
        fileStatus = gitFileStatus(this.resolve(file)).fileStatus
        if (!GitStatusOk.includes(fileStatus)) {
            throw new UnsavedChangesError(
                `Refusing to clobber ${fileStatus} changes in git`
            )
        }
    } catch (err) {
        log.error(err, {throwing: true})
        if (err.name == 'ExecResultError') {
            log.error('Git execution failed with', {code: err.code})
        } else if (err.name == 'ExecExitError') {
            const {status, stderr} = err
            log.error('Git command exited with', {status})
            if (stderr) {
                log.warn('<stderr>\n' + stderr)
                log.warn('</stderr>')
                delete err.stderr
            }
        } else if (err.name == 'UnsavedChangesError') {
            log.error('Unsaved changes in git for', {file: rel}, {fileStatus})
            log.error('Commit, stash, or abandon the changes before continuing')
        }
        log.info('Use option', {gitCheck: false}, 'to ignore this check.')
        throw err
    }
    this.verbose(1, 'gitCheck', {fileStatus})
}

/**
 * Write to a file.
 *
 * @private
 *
 * @throws {ExecExitError}
 * @throws {ExecResultError}
 * @throws {TypeError}
 * @throws {UnsavedChangesError}
 *
 * @param {string} file The file path
 * @param {buffer} content The content to write
 */
function writeFile(file, content) {
    checkArg(
        file    , 'file'    , 'string',
        content , 'content' , 'buffer',
    )
    const rel = this.relPath(file)
    checkGitDirty.call(this, file)
    if (this.opts.dryRun) {
        this.logger.warn('Dry run only, not writing', {file: rel})
    } else {
        fs.writeFileSync(file, content)
    }
}
