const stream = require('stream')
const {strings: {stripAnsi}} = require('@quale/core')

class MockOutput extends stream.Writable {

    constructor(opts = {}) {
        super()
        this.raw = ''
        this.opts = {...opts}
    }

    write(chunk) {
        this.raw += chunk
        if (this.debug) {
            process.stderr.write(chunk)
        }
    }

    get debug() {
        return Boolean(this.opts.debug)
    }

    set debug(v) {
        this.opts.debug = Boolean(v)
    }

    get lines() { return this.raw.split('\n') }

    get plain() { return stripAnsi(this.raw) }
}

module.exports = {MockOutput}