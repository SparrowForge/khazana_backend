import {
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  PayloadTooLargeException,
  Post,
  Request,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import * as multer from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { UploadService } from './upload.service';
import { ALLOWED_FILE_DESCRIPTION, describeRejectedFile, resolveFileType } from './file-type';

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const formatMb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Multer aborts on its own size limit before the handler runs, and Nest turns
 * that into a bare "File too large". Rewrite it so the response says what the
 * limit actually is.
 */
@Catch(PayloadTooLargeException)
class FileTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    res.status(413).json({
      statusCode: 413,
      message: `File is too large. The maximum upload size is ${formatMb(MAX_FILE_SIZE)}.`,
      error: 'Payload Too Large',
    });
  }
}

@ApiTags('Upload')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@UseFilters(FileTooLargeFilter)
@Controller('upload')
export class UploadController {
  constructor(private uploadService: UploadService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      // Reject an unsupported type up front rather than after buffering the
      // whole file into memory and failing in the service.
      fileFilter: (_req, file, cb) => {
        if (resolveFileType(file.mimetype, file.originalname)) return cb(null, true);
        cb(
          new BadRequestException(
            `Unsupported file type ${describeRejectedFile(file.mimetype, file.originalname)}. Allowed: ${ALLOWED_FILE_DESCRIPTION}`,
          ),
          false,
        );
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file to Cloudinary and log it in media_files' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Returns the full media_files database record',
    schema: {
      type: 'object',
      properties: {
        id:                 { type: 'string', format: 'uuid' },
        fileName:           { type: 'string' },
        fileUrl:            { type: 'string' },
        fileType:           { type: 'string' },
        mimeType:           { type: 'string' },
        fileSize:           { type: 'integer' },
        cloudinaryPublicId: { type: 'string' },
        uploadedById:       { type: 'string', format: 'uuid', nullable: true },
        isDelete:           { type: 'boolean' },
        createdAt:          { type: 'string', format: 'date-time' },
        updatedAt:          { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Unsupported or empty file' })
  @ApiResponse({ status: 413, description: 'File exceeds the maximum upload size' })
  uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!file) throw new BadRequestException('No file provided. Send the file under the "file" field.');
    if (!file.size) throw new BadRequestException(`"${file.originalname}" is empty (0 bytes).`);
    return this.uploadService.uploadFile(file, req.user?.id);
  }
}

