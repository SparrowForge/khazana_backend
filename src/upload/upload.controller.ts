import {
  Controller,
  Post,
  Request,
  UploadedFile,
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

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

@ApiTags('Upload')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  constructor(private uploadService: UploadService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
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
  uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!file) throw new BadRequestException('No file provided. Send the file under the "file" field.');
    return this.uploadService.uploadFile(file, req.user?.id);
  }
}
