import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareLocalArchive } from '../../.test-dist/data/local-archive.js';

const source = Buffer.from(readFileSync('../fixtures/golden-v1.ibl-ephys-atlas.zip'));
const LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const CENTRAL_HEADER = Buffer.from([0x50, 0x4b, 0x01, 0x02]);

function archive(bytes) {
  return new Blob([bytes], { type: 'application/zip' });
}

function firstHeader(bytes, signature) {
  const offset = bytes.indexOf(signature);
  assert.notEqual(offset, -1, `missing ZIP signature ${signature.toString('hex')}`);
  return offset;
}

function localDataOffset(bytes, local) {
  const filenameBytes = bytes.readUInt16LE(local + 26);
  const extraBytes = bytes.readUInt16LE(local + 28);
  return local + 30 + filenameBytes + extraBytes;
}

test('strict preparation rejects truncated central-directory records', async () => {
  await assert.rejects(() => prepareLocalArchive(archive(source.subarray(0, source.length - 8))));
});

test('strict preparation rejects central and local compression-method disagreement', async () => {
  const malformed = Buffer.from(source);
  const local = firstHeader(malformed, LOCAL_HEADER);
  const current = malformed.readUInt16LE(local + 8);
  malformed.writeUInt16LE(current === 0 ? 8 : 0, local + 8);

  await assert.rejects(() => prepareLocalArchive(archive(malformed)));
});

test('strict preparation rejects central and local filename disagreement', async () => {
  const malformed = Buffer.from(source);
  const local = firstHeader(malformed, LOCAL_HEADER);
  const filenameOffset = local + 30;
  malformed[filenameOffset] ^= 0x01;

  await assert.rejects(() => prepareLocalArchive(archive(malformed)));
});

test('strict preparation rejects central and local expanded-size disagreement', async () => {
  const malformed = Buffer.from(source);
  const central = firstHeader(malformed, CENTRAL_HEADER);
  malformed.writeUInt32LE(malformed.readUInt32LE(central + 24) + 1, central + 24);

  await assert.rejects(() => prepareLocalArchive(archive(malformed)));
});

test('strict preparation rejects corruption inside an entry payload', async () => {
  const malformed = Buffer.from(source);
  const central = firstHeader(malformed, CENTRAL_HEADER);
  const local = malformed.readUInt32LE(central + 42);
  const compressedBytes = malformed.readUInt32LE(central + 20);
  assert.equal(malformed.subarray(local, local + 4).compare(LOCAL_HEADER), 0);
  assert.ok(compressedBytes > 0);
  malformed[localDataOffset(malformed, local) + Math.floor(compressedBytes / 2)] ^= 0x01;

  await assert.rejects(() => prepareLocalArchive(archive(malformed)));
});

test('preparation observes cancellation after ZIP reading has started', async () => {
  const controller = new AbortController();
  const state = { reads: 0 };
  class AbortingBlob extends Blob {
    constructor(parts, options, shared = state) {
      super(parts, options);
      this.shared = shared;
    }

    slice(start, end, type) {
      return new AbortingBlob([super.slice(start, end, type)], { type }, this.shared);
    }

    async arrayBuffer() {
      this.shared.reads += 1;
      if (this.shared.reads === 1) {
        controller.abort(new DOMException('cancelled after ZIP read began', 'AbortError'));
      }
      return super.arrayBuffer();
    }
  }
  const input = new AbortingBlob([source], { type: 'application/zip' });

  await assert.rejects(() => prepareLocalArchive(input, controller.signal), { name: 'AbortError' });
  assert.ok(state.reads >= 1);
});
