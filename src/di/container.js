class Container {
  constructor() {
    this.factories = new Map();
    this.singletons = new Map();
  }

  register(name, factory, { singleton = true } = {}) {
    this.factories.set(name, { factory, singleton });
  }

  resolve(name) {
    const registration = this.factories.get(name);
    if (!registration) {
      throw new Error(`Service not registered: ${name}`);
    }

    if (registration.singleton && this.singletons.has(name)) {
      return this.singletons.get(name);
    }

    const instance = registration.factory(this);
    if (registration.singleton) {
      this.singletons.set(name, instance);
    }

    return instance;
  }
}

module.exports = { Container };
