import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import * as path from 'path';
import { PrismaService } from '../database/prisma.service';

const EXT_TYPE_MAP: Record<string, string> = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image',
  pdf: 'pdf',
  doc: 'doc', docx: 'doc',
  xls: 'excel', xlsx: 'excel',
};

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
    const ext      = path.extname(file.originalname).toLowerCase().replace('.', '');
    const fileType = EXT_TYPE_MAP[ext];

    if (!fileType) {
      throw new BadRequestException(
        `Unsupported file type ".${ext}". Allowed: jpg, png, gif, webp, svg, pdf, doc, docx, xls, xlsx`,
      );
    }

    const folder = this.config.get<string>('CLOUDINARY_FOLDER') ?? 'uploads';
    const stem   = path.parse(file.originalname).name.replace(/\s+/g, '_');

    // Upload to Cloudinary using resource_type: 'auto' to handle all types
    const cloudinaryResult = await new Promise<{ public_id: string; secure_url: string }>(
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
