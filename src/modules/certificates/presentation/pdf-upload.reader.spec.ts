import { Readable } from 'node:stream';
import type { Request } from 'express';
import { readPdfSha256 } from './pdf-upload.reader';

describe('readPdfSha256', () => {
  it('hashes a PDF stream without buffering the whole file in the result', async () => {
    const request = Readable.from([Buffer.from('%PDF-1.7\nstream')]) as Request;
    request.header = ((name: string) =>
      name === 'content-type'
        ? 'application/pdf'
        : undefined) as Request['header'];

    await expect(readPdfSha256(request)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a non-pdf payload', async () => {
    const request = Readable.from([Buffer.from('not a pdf')]) as Request;
    request.header = ((name: string) =>
      name === 'content-type'
        ? 'application/pdf'
        : undefined) as Request['header'];

    await expect(readPdfSha256(request)).rejects.toMatchObject({
      status: 400,
    });
  });
});
