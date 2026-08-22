class MessageQueue {
  constructor({ maxQueueSize = 1000 } = {}) {
    this.maxQueueSize = maxQueueSize;
    this.queue = [];
    this.processing = false;
    this.inFlight = 0;
  }

  async enqueue(task) {
    if (this.queue.length + this.inFlight >= this.maxQueueSize) {
      return false;
    }

    this.queue.push(task);

    if (!this.processing) {
      this.processing = true;
      queueMicrotask(() => this.process());
    }

    return true;
  }

  async process() {
    while (this.queue.length > 0) {
      const current = this.queue.shift();
      this.inFlight += 1;
      try {
        await current();
      } finally {
        this.inFlight -= 1;
      }
    }

    this.processing = false;
  }
}

module.exports = { MessageQueue };
