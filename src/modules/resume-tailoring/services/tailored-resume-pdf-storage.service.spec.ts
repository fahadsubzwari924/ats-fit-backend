import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TailoredResumePdfStorageService } from './tailored-resume-pdf-storage.service';
import { S3Service } from '../../../shared/modules/external/services/s3.service';

describe('TailoredResumePdfStorageService', () => {
  let service: TailoredResumePdfStorageService;
  let configGet: jest.Mock;
  let uploadFile: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn();
    uploadFile = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TailoredResumePdfStorageService,
        { provide: ConfigService, useValue: { get: configGet } },
        { provide: S3Service, useValue: { uploadFile } },
      ],
    }).compile();
    service = module.get(TailoredResumePdfStorageService);
  });

  it('returns null and skips upload when no tailored-PDF bucket is configured', async () => {
    configGet.mockImplementation(() => undefined);
    const result = await service.uploadGeneratedPdf(
      Buffer.from('%PDF'),
      'user-1',
    );
    expect(result).toBeNull();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('uses AWS_S3_CANDIDATES_RESUMES_BUCKET when generated bucket is unset', async () => {
    configGet.mockImplementation((key: string) => {
      if (key === 'AWS_S3_GENERATED_RESUMES_BUCKET') {
        return undefined;
      }
      if (key === 'AWS_S3_CANDIDATES_RESUMES_BUCKET') {
        return 'candidates-bucket';
      }
      return undefined;
    });
    uploadFile.mockResolvedValue(undefined);
    const buf = Buffer.from('%PDF-1');
    const key = await service.uploadGeneratedPdf(buf, 'user-1');
    expect(key).toMatch(/^tailored-resumes\/user-1\/[0-9a-f-]{36}\.pdf$/);
    expect(uploadFile).toHaveBeenCalledWith({
      bucketName: 'candidates-bucket',
      key,
      file: buf,
      contentType: 'application/pdf',
    });
  });

  it('returns key with tailored-resumes/{owner}/{uuid}.pdf on success', async () => {
    configGet.mockImplementation((key: string) =>
      key === 'AWS_S3_GENERATED_RESUMES_BUCKET'
        ? 'generated-bucket'
        : undefined,
    );
    uploadFile.mockResolvedValue(undefined);
    const buf = Buffer.from('%PDF-1');
    const ownerId = '07559858-7650-464f-b219-e57a00bc0f6f';
    const key = await service.uploadGeneratedPdf(buf, ownerId);

    expect(key).toMatch(
      new RegExp(
        `^tailored-resumes/${ownerId.replace(/-/g, '\\-')}/[0-9a-f-]{36}\\.pdf$`,
      ),
    );
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(uploadFile).toHaveBeenCalledWith({
      bucketName: 'generated-bucket',
      key,
      file: buf,
      contentType: 'application/pdf',
    });
  });

  it('does not retry when error is access denied', async () => {
    configGet.mockImplementation((key: string) =>
      key === 'AWS_S3_GENERATED_RESUMES_BUCKET' ? 'bucket' : undefined,
    );
    uploadFile.mockRejectedValue(
      new Error('Access denied to S3 resource during upload operation'),
    );
    const key = await service.uploadGeneratedPdf(Buffer.from('x'), 'u1');
    expect(key).toBeNull();
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it('retries on transient errors then succeeds', async () => {
    jest.useFakeTimers();
    configGet.mockImplementation((key: string) =>
      key === 'AWS_S3_GENERATED_RESUMES_BUCKET' ? 'bucket' : undefined,
    );
    uploadFile
      .mockRejectedValueOnce(
        new Error('S3 service error during upload: SlowDown'),
      )
      .mockResolvedValueOnce(undefined);

    const uploadPromise = service.uploadGeneratedPdf(Buffer.from('x'), 'u1');

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(300);
    const key = await uploadPromise;

    jest.useRealTimers();
    expect(key).toMatch(/^tailored-resumes\/u1\/[0-9a-f-]{36}\.pdf$/);
    expect(uploadFile).toHaveBeenCalledTimes(2);
  });
});
