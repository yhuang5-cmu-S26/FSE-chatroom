const test = require('node:test');
const assert = require('node:assert/strict');
const { HelpRequestRepository, DEFAULT_PROJECTION } = require('../src/data/helpRequestRepository');

test('HelpRequestRepository applies projection and sort for hot path queries', async () => {
  const calls = {};
  const toArray = async () => [{ _id: '1' }];
  const limit = (value) => {
    calls.limit = value;
    return { toArray };
  };
  const sort = (value) => {
    calls.sort = value;
    return { limit };
  };
  const find = (query, options) => {
    calls.query = query;
    calls.options = options;
    return { sort };
  };

  const repo = new HelpRequestRepository({ find });
  const result = await repo.findHotRequests({ limit: 10 });

  assert.deepEqual(result, [{ _id: '1' }]);
  assert.deepEqual(calls.query, { status: { $in: ['pending', 'assigned'] } });
  assert.deepEqual(calls.options, { projection: DEFAULT_PROJECTION });
  assert.deepEqual(calls.sort, { priority: -1, updatedAt: -1 });
  assert.equal(calls.limit, 10);
});

test('HelpRequestRepository creates expected compound indexes', async () => {
  const indexCalls = [];
  const createIndex = async (spec, options) => {
    indexCalls.push({ spec, options });
  };

  const repo = new HelpRequestRepository({ createIndex });
  await repo.createIndexes();

  assert.deepEqual(indexCalls, [
    {
      spec: { status: 1, priority: -1, updatedAt: -1 },
      options: { name: 'status_priority_updatedAt' },
    },
    {
      spec: { location: '2dsphere', status: 1 },
      options: { name: 'location_status' },
    },
  ]);
});
