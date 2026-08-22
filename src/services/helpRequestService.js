const { z } = require('zod');

const requestSchema = z.object({
  requesterId: z.string().min(1),
  category: z.string().min(1),
  priority: z.number().int().min(1).max(5),
  location: z
    .object({
      type: z.literal('Point'),
      coordinates: z.tuple([z.number(), z.number()]),
    })
    .optional(),
  description: z.string().min(1).optional(),
});

class HelpRequestService {
  constructor(repository) {
    this.repository = repository;
  }

  async initialize() {
    await this.repository.createIndexes();
  }

  async create(payload) {
    const validated = requestSchema.parse(payload);
    return this.repository.create(validated);
  }

  async getHotRequests(limit) {
    return this.repository.findHotRequests({ limit });
  }
}

module.exports = { HelpRequestService };
