/**
 * node-po-extractor
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
// Node requires
const {EventEmitter} = require('events')
const fs = require('fs')

// Package requires
const {
    checkArg,
    gitFileStatus,
    mergePlain,
    relPath,
    resolveSafe,
} = require('./util')
const Logger = require('./logger')
const {UnsavedChangesError} = require('./errors')

// Default options
const Defaults = {
    baseDir    : '.',
    gitCheck   : true,
    verbose  : 0,
    logger     : null,
    logging    : {},
}

class Base extends EventEmitter {

    constructor(...opts) {
        super()
        this.opts = mergePlain(Defaults, ...opts)
        if (!this.logger) {
            this.logger = new Logger(this.opts.logging)
        }
        this.logLevel = this.opts.logging.logLevel
    }

   /**
    * Read a file.
    *
    * @throws {ArgumentError}
    *
    * @param {string} The file path
    * @return {buffer} The file content
    */
   readFile(file) {
       checkArg(file, 'file', 'string')
       file = resolveSafe(this.opts.baseDir, file)
       return fs.readFileSync(file)
   }

   /**
    * Write to a file.
    *
    * @throws {ArgumentError}
    * @throws {ExecExitError}
    * @throws {ExecResultError}
    * @throws {UnsavedChangesError}
    *
    * @param {string} The file path
    * @param {buffer} The content to write
    * @return {undefined}
    */
   writeFile(file, content) {
       checkArg(
           file    , 'file'    , 'string',
           content , 'content' , 'buffer',
       )
       const {baseDir} = this.opts
       file = resolveSafe(baseDir, file)
       this._checkGitDirty(file)
       if (this.opts.dryRun) {
           this.logger.warn('Dry run only, not writing', {file: relPath(baseDir, file)})
       } else {
           fs.writeFileSync(file, content)
       }
   }

   /**
    * Logs a message according to verbose setting.
    *
    * @throws {ArgumentError}
    *
    * @param {integer} The verbose level of the message
    * @param {...any} The message(s)
    * @return {undefined}
    */
   verbose(vlevel, ...args) {
       checkArg(vlevel, 'vlevel', 'number')
       if (vlevel > this.opts.verbose && vlevel + 2 > this.logLevel) {
           return
       }
       this.logger.info(...args)
   }

   /**
    *
    */
   get logger() {
       return this.opts.logger
   }

   /**
    *
    */
   set logger(logger) {
       this.opts.logger = logger
       if ('logLevel' in logger) {
           logger.logLevel = this.opts.logging.logLevel
       }
       if (logger instanceof Logger) {
            // store a reference to propagate runtime changes.
            this.opts.logging = this.logger.opts
       }
   }

   /**
    *
    */
   get logLevel() {
       if ('logLevel' in this.logger) {
           return this.logger.logLevel
       }
       return this.opts.logging.logLevel
   }

   /**
    *
    */
   set logLevel(level) {
       if ('logLevel' in this.logger) {
           this.logger.logLevel = level
           this.opts.logging.logLevel = this.logger.logLevel
       } else {
           this.opts.logging.logLevel = level
       }
   }

   /**
    * @private
    *
    * @throws {ExecExitError}
    * @throws {ExecResultError}
    * @throws {UnsavedChangesError}
    *
    * @param {string} The file path
    * @return {undefined}
    */
   _checkGitDirty(file) {
       const log = this.logger
       const {baseDir, gitCheck} = this.opts
       const rel = relPath(baseDir, file)
       this.verbose(1, 'gitCheck', {gitCheck}, {file: rel})
       file = resolveSafe(baseDir, file)
       if (!gitCheck) {
           return
       }
       let fileStatus
       try {
           fileStatus = gitFileStatus(file).fileStatus
           if (fileStatus != 'clean') {
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
                   log.warn('stderr:>>', '\n' + stderr)
                   log.warn('<<:stderr')
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
}

module.exports = Base