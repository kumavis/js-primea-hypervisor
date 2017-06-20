const PortManager = require('./portManager.js')
const Message = require('primea-message')

module.exports = class ExoInterface {
  /**
   * the ExoInterface manages the varous message passing functions and provides
   * an interface for the containers to use
   * @param {Object} opts
   * @param {Object} opts.id
   * @param {Object} opts.state
   * @param {Object} opts.hypervisor
   * @param {Object} opts.Container
   */
  constructor (opts) {
    this.state = opts.state
    this.hypervisor = opts.hypervisor
    this.id = opts.id
    this.container = new opts.container.Constructor(this, opts.container.args)

    this.ticks = 0
    this.containerState = 'idle'
    this._waitingMap = new Map()

    // create the port manager
    this.ports = new PortManager(Object.assign({
      exoInterface: this
    }, opts))
  }

  /**
   * adds a message to this containers message queue
   * @param {Message} message
   */
  queue (portName, message) {
    message._hops++
    this.ports.queue(portName, message)
    if (this.containerState !== 'running') {
      this.containerState = 'running'
      if (portName) {
        this._runNextMessage()
      } else {
        this.run(message, true)
      }
    }
  }

  async _runNextMessage () {
    if (!this.ports.isSaturated()) {
      await this.hypervisor.scheduler.wait(this.ticks, this.id)
    }

    if (this.ports.hasMessages()) {
      let message = this.ports.peekNextMessage()
      if (this.ticks < message._fromTicks) {
        this.ticks = message._fromTicks
          // check for tie messages
        this.hypervisor.scheduler.update(this)
        await this.hypervisor.scheduler.wait(this.ticks, this.id)
      }
      message = this.ports.nextMessage()
      this.currentMessage = message

      // run the next message
      this.run(message)
    } else {
      // if no more messages then shut down
      this.hypervisor.scheduler.done(this)
    }
  }

  /**
   * run the kernels code with a given enviroment
   * The Kernel Stores all of its state in the Environment. The Interface is used
   * to by the VM to retrive infromation from the Environment.
   * @returns {Promise}
   */
  async run (message, init = false) {
    let result
    if (message.data === 'delete') {
      this.ports._delete(message.portName)
    } else {
      const method = init ? 'initailize' : 'run'

      try {
        result = await this.container[method](message) || {}
      } catch (e) {
        result = {
          exception: true,
          exceptionError: e
        }
      }
    }
    // message.response(result)
    this._runNextMessage()
    return result
  }

  /**
   * updates the number of ticks that the container has run
   * @param {Number} count - the number of ticks to add
   */
  incrementTicks (count) {
    this.ticks += count
    this.hypervisor.scheduler.update(this)
  }

  /**
   * creates a new message
   * @param {*} data
   */
  createMessage (opts) {
    const message = new Message(opts)
    for (const port of message.ports) {
      if (this.ports.isBound(port)) {
        throw new Error('message must not contain bound ports')
      }
    }
    return message
  }

  /**
   * sends a message to a given port
   * @param {Object} portRef - the port
   * @param {Message} message - the message
   */
  async send (port, message) {
    // set the port that the message came from
    message._fromTicks = this.ticks

    // if (this.currentMessage !== message && !message.responsePort) {
    //   this.currentMessage._addSubMessage(message)
    // }

    if (port.destId) {
      const id = port.destId
      const instance = await this.hypervisor.getInstance(id)
      instance.queue(port.destName, message)
    } else {
      port.destPort.messages.push(message)
    }
  }
}
