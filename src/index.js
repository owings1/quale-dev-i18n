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
import {lget, lset} from '@quale/core/objects.js'
import Sort from './sorters.js'
import {MessageConflictError} from './errors.js'

/**
 * Index extracted messages.
 */
export default class Index  {

    constructor() {
        this.clear()
    }

    /**
     * Clear the index.
     *
     * @return {Index} self
     */
    clear() {
        this.idx = {}
        return this
    }

    /**
     * Add a token to the index.
     *
     * @throws {MessageConflictError} When a different non-empty comment already
     *         exists for the context/key/reference combination.
     * @param {String} The message context (msgctxt)
     * @param {String} The message key (msgid)
     * @param {String} The reference (path/to/file:line)
     * @param {String} The extracted comment
     * @return {Index} self
     */
    add(ctx, key, ref, cmt) {
        const chk = lget(this.idx, [ctx, key, ref, 'cmt'])
        if (chk && chk != cmt) {
            throw new MessageConflictError(
                `message: '${key}' ref: '${ref}' cmt_stored: '${chk}' cmt_new: '${cmt}'`
            )
        }
        lset(this.idx, [ctx, key, ref, 'cmt'], cmt)
        return this
    }

    /**
     * List all contexts.
     *
     * @return {String[]}
     */
    contexts() {
        return Object.keys(this.idx)
    }

    /**
     * List all keys (msgid) for a context.
     *
     * @param {String} ctx
     * @return {String[]}
     */
    keys(ctx) {
        return Object.keys(this.idx[ctx] || {})
    }

    /**
     * List all references (path/to/file:line) for a message, ordered
     * file, line.
     *
     * @param {String} ctx
     * @param {String} key
     * @return {String[]} The references
     */
    refs(ctx, key) {
        return Object.keys(this.idx[ctx][key]).sort(Sort.ref)
    }

    /**
     * List all comments (path/to/file:line) for a message, ordered
     * their reference (file, line).
     *
     * @param {String} ctx
     * @param {String} key
     * @return {String[]} The comments
     */
    comments(ctx, key) {
        return this.refs(ctx, key).map(ref => this.comment(ctx, key, ref)).filter(Boolean)
    }

    /**
     * Get the extracted comment for a message reference.
     *
     * @param {String}
     * @param {String}
     * @param {String}
     * @return {String}
     */
    comment(ctx, key, ref) {
        return this.idx[ctx][key][ref].cmt
    }
}
