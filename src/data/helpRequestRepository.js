const DEFAULT_PROJECTION = {
  _id: 1,
  requesterId: 1,
  category: 1,
  priority: 1,
  location: 1,
  status: 1,
  createdAt: 1,
  updatedAt: 1,
};

class HelpRequestRepository {
  constructor(collection) {
    this.collection = collection;
  }

  async createIndexes() {
    await this.collection.createIndex({ status: 1, priority: -1, updatedAt: -1 }, { name: 'status_priority_updatedAt' });
    await this.collection.createIndex({ location: '2dsphere', status: 1 }, { name: 'location_status' });
  }

  async findHotRequests({ limit = 20, statuses = ['pending', 'assigned'] } = {}) {
    const query = { status: { $in: statuses } };

    return this.collection
      .find(query, { projection: DEFAULT_PROJECTION })
      .sort({ priority: -1, updatedAt: -1 })
      .limit(limit)
      .toArray();
  }

  async create(request) {
    const doc = {
      ...request,
      status: request.status || 'pending',
      createdAt: request.createdAt || new Date(),
      updatedAt: new Date(),
    };

    const result = await this.collection.insertOne(doc);
    return { ...doc, _id: result.insertedId };
  }
}

module.exports = { HelpRequestRepository, DEFAULT_PROJECTION };
