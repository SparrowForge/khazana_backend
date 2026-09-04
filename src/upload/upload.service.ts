import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import * as path from 'path';
import { PrismaService } from '../database/prisma.service';
import {
  ALLOWED_FILE_DESCRIPTION,
  describeRejectedFile,
  resolveFileType,
} from './file-type';

@Injectable()
export class UploadService {
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    cloudinary.config({
      cloud_name: config.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key:    config.get<string>('CLOUDINARY_API_KEY'),
      api_secret: config.get<string>('CLOUDINARY_API_SECRET'),
    });
  }

  async uploadFile(file: Express.Multer.File, uploadedById?: string) {
    // Mimetype first, extension as fallback — see file-type.ts.
    const fileType = resolveFileType(file.mimetype, file.originalname);

    if (!fileType) {
      throw new BadRequestException(
        `Unsupported file type ${describeRejectedFile(file.mimetype, file.originalname)}. Allowed: ${ALLOWED_FILE_DESCRIPTION}`,
      );
    }

    const folder = this.config.get<string>('CLOUDINARY_FOLDER') ?? 'uploads';
    // Cloudinary rejects a public_id containing ? & # \ % < >, so collapse
    // everything outside [A-Za-z0-9_.-] rather than only whitespace — a file
    // like "Date & Honey Laddu.jpg" used to fail the upload outright.
    const stem =
      path.parse(file.originalname).name
        .replace(/[^\w.-]+/g, '_')
        .replace(/^[_.]+|_+$/g, '')
        .slice(0, 100) || 'file';

    // Upload to Cloudinary using resource_type: 'auto' to handle all types
    let cloudinaryResult: { public_id: string; secure_url: string };
    try {
      cloudinaryResult = await new Promise<{ public_id: string; secure_url: string }>(
        (resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder,
              resource_type: 'auto',
              public_id: `${Date.now()}_${stem}`,
              overwrite: false,
            },
            (error, result) => {
              if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
              resolve({ public_id: result.public_id, secure_url: result.secure_url });
            },
          );
          stream.end(file.buffer);
        },
      );
    } catch (err: any) {
      // Cloudinary rejects oversized or over-resolution images (and quota
      // overruns) with a real reason. Surface it instead of letting the raw
      // error become an opaque 500 the UI cannot explain.
      const reason = err?.message ?? err?.error?.message ?? 'unknown error';
      const status = err?.http_code ?? err?.error?.http_code;

      if (status === 400 || status === 420) {
        throw new BadRequestException(`Image rejected by the media server: ${reason}`);
      }
      throw new ServiceUnavailableException(
        `Could not reach the media server (${reason}). Please try again.`,
      );
    }

    // Persist record in media_files table
    const record = await this.prisma.mediaFile.create({
      data: {
        fileName:           file.originalname,
        fileUrl:            cloudinaryResult.secure_url,
        fileType,
        mimeType:           file.mimetype,
        fileSize:           file.size,
        cloudinaryPublicId: cloudinaryResult.public_id,
        uploadedById:       uploadedById ?? null,
      },
    });

    return record;
  }
}
