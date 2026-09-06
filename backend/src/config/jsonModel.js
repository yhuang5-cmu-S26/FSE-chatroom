const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const defaultDataDir = process.env.JSON_DATA_DIR
  ? path.resolve(process.env.JSON_DATA_DIR)
  : path.resolve(__dirname, '../../tmp/mock-data');
const clone = (value) => JSON.parse(JSON.stringify(value));
const id = () => randomBytes(12).toString('hex');

function ensureFile(collection, dataDir = defaultDataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, `${collection}.json`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]\n');
  return file;
}

function read(collection, dataDir) {
  return JSON.parse(fs.readFileSync(ensureFile(collection, dataDir), 'utf8'));
}

function write(collection, rows, dataDir) {
  const file = ensureFile(collection, dataDir);
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(rows, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function matches(row, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && '$ne' in expected) return String(actual) !== String(expected.$ne);
    if (Array.isArray(actual)) return actual.map(String).includes(String(expected));
    return String(actual) === String(expected);
  });
}

function decorate(collection, row, dataDir) {
  if (!row) return null;
  const doc = clone(row);
  Object.defineProperty(doc, 'id', { get: () => String(doc._id), enumerable: true });
  doc.toObject = () => clone(doc);
  doc.save = async () => {
    const rows = read(collection, dataDir);
    const index = rows.findIndex((item) => item._id === doc._id);
    doc.updatedAt = new Date().toISOString();
    const plain = clone(doc);
    if (index >= 0) rows[index] = plain; else rows.push(plain);
    write(collection, rows, dataDir);
    return doc;
  };
  return doc;
}

class Query {
  constructor(collection, filter, one = false, dataDir = defaultDataDir) { this.collection = collection; this.filter = filter; this.one = one; this.dataDir = dataDir; this.sortSpec = null; this.max = null; }
  select() { return this; }
  sort(spec) { this.sortSpec = spec; return this; }
  limit(value) { this.max = value; return this; }
  async lean() { return clone(await this.exec()); }
  async exec() {
    let rows = read(this.collection, this.dataDir).filter((row) => matches(row, this.filter));
    if (this.sortSpec) { const [key, direction] = Object.entries(this.sortSpec)[0]; rows.sort((a, b) => direction * String(a[key] || '').localeCompare(String(b[key] || ''))); }
    if (this.max) rows = rows.slice(0, this.max);
    return this.one ? decorate(this.collection, rows[0], this.dataDir) : rows.map((row) => decorate(this.collection, row, this.dataDir));
  }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
}

function createJsonModel(collection, defaults = {}, options = {}) {
  const dataDir = options.dataDir ? path.resolve(options.dataDir) : defaultDataDir;
  return class JsonModel {
    static find(filter = {}) { return new Query(collection, filter, false, dataDir); }
    static findOne(filter = {}) { return new Query(collection, filter, true, dataDir); }
    static findById(value) { return new Query(collection, { _id: value }, true, dataDir); }
    static async exists(filter = {}) { return Boolean(await new Query(collection, filter, true, dataDir)); }
    static async create(input) { const now = new Date().toISOString(); const doc = decorate(collection, { ...clone(defaults), ...clone(input), _id: id(), createdAt: now, updatedAt: now }, dataDir); await doc.save(); return doc; }
    static async findByIdAndDelete(value) { const rows = read(collection, dataDir); const index = rows.findIndex((row) => row._id === String(value)); if (index < 0) return null; const [removed] = rows.splice(index, 1); write(collection, rows, dataDir); return decorate(collection, removed, dataDir); }
    static async findByIdAndUpdate(value, update, options = {}) { const doc = await this.findById(value); if (!doc) return null; Object.assign(doc, clone(update)); await doc.save(); return options.new ? doc : doc; }
    static async bulkWrite(operations) { for (const operation of operations) { const { filter, update } = operation.updateOne; if (!await this.exists(filter)) await this.create({ ...filter, ...(update.$setOnInsert || {}) }); } }
  };
}

function initializeJsonStore() {
  for (const name of ['users', 'relationships', 'messages', 'groups', 'posts', 'checkins', 'speed-tests']) ensureFile(name);
  console.log(`JSON mock store ready at ${defaultDataDir}`);
}

module.exports = { createJsonModel, initializeJsonStore };
