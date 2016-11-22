const Vertex = require('./deps/kernelVertex')
// The Kernel Exposes this Interface to VM instances it makes
const Interface = require('./EVMinterface.js')
const InterfaceAPI = require('./interfaceAPI.js')
const Environment = require('./environment.js')

module.exports = class Kernel {
  constructor (opts = {}) {
    this.state = opts.state || new Vertex()
    this.parent = opts.parent

    // if code is bound to this kernel then create the interfaceAPI and the
    // imports
    if (opts.code) {
      this.interfaceAPI = new InterfaceAPI(opts.code)
      this.imports = buildImports(this.interfaceAPI, opts.interfaces)
    }

    /**
     * Builds a import map with an array of given interfaces
     */
    function buildImports (api, interfaces = [Interface]) {
      return interfaces.reduce((obj, Interface) => {
        obj[Interface.name] = new Interface(api).exports
        return obj
      }, {})
    }
  }

  /**
   * run the kernels code with a given enviroment
   * The Kernel Stores all of its state in the Environment. The Interface is used
   * to by the VM to retrive infromation from the Environment.
   */
  async run (environment = new Environment({state: this.state}), imports = this.imports) {
    await this.interfaceAPI.run(environment, imports)
    return environment
  }

  async messageReceiver (message) {
    // let the code handle the message if there is code
    if (this.code) {
      const environment = new Environment(message)
      let result = await this.run(environment)
      if (!result.execption) {
        this.state = result.state
      }
    } else if (message.to.length) {
      // else forward the message on to the destination contract
      let [vertex, done] = await this.state.update(message.to)
      message.to = []
      await vertex.kernel.messageReceiver(message)
      done(vertex)
    }
  }

  copy () {
    return new Kernel({
      state: this.state.copy(),
      code: this.code,
      interfaces: this.interfaces,
      parent: this.parent
    })
  }
}
