import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  StreamableFile,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createReadStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import type { MediaKind, MediaRef } from "./workshop.model";
import { MediaRepository } from "./media.repository";

const runFile = promisify(execFile);
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
const videoTypes = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const audioTypes = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/webm",
  "audio/flac",
]);

@Injectable()
export class MediaService {
  private readonly directory = join(process.cwd(), ".local-data", "media");

  constructor(
    private readonly config: ConfigService,
    private readonly repository: MediaRepository,
  ) {}

  async uploadImage(file?: Express.Multer.File): Promise<MediaRef> {
    this.validate(file, "image");
    const input = file!;
    let output: Buffer;
    try {
      output = await sharp(input.buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78, effort: 4 })
        .toBuffer();
    } catch {
      throw new BadRequestException("Не удалось обработать изображение");
    }
    return this.store("image", output);
  }

  async uploadVideo(file?: Express.Multer.File): Promise<MediaRef> {
    this.validate(file, "video");
    if (!ffmpegPath) throw new Error("FFmpeg binary is unavailable");
    const temporary = await mkdtemp(join(tmpdir(), "qwiza-video-"));
    const input = join(temporary, "input");
    const output = join(temporary, "output.mp4");
    try {
      await writeFile(input, file!.buffer);
      await runFile(
        ffmpegPath,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          input,
          "-map",
          "0:v:0",
          "-map",
          "0:a?",
          "-sn",
          "-dn",
          "-c:v",
          "libx264",
          "-vf",
          "scale=w=1280:h=720:force_original_aspect_ratio=decrease",
          "-preset",
          "veryfast",
          "-crf",
          "30",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "96k",
          "-movflags",
          "+faststart",
          output,
        ],
        { timeout: 300_000, maxBuffer: 1024 * 1024 },
      );
      if ((await stat(output)).size > this.limits().videoMaxBytes)
        throw new PayloadTooLargeException("Видео остаётся слишком большим после обработки");
      return await this.store("video", await readFile(output), await this.probeDuration(output));
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException("Не удалось обработать видео. Проверь формат файла.");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async uploadAudio(
    file: Express.Multer.File | undefined,
    start: number,
    end: number,
  ): Promise<MediaRef> {
    this.validate(file, "audio");
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end - start < 2 ||
      end - start > 30
    )
      throw new BadRequestException("Выбери фрагмент от 2 до 30 секунд");
    if (!ffmpegPath) throw new Error("FFmpeg binary is unavailable");
    const temporary = await mkdtemp(join(tmpdir(), "qwiza-audio-"));
    const input = join(temporary, "input");
    const output = join(temporary, "clip.mp3");
    try {
      await writeFile(input, file!.buffer);
      const sourceDuration = await this.probeDuration(input);
      if (end > sourceDuration + 0.25)
        throw new BadRequestException("Конец фрагмента выходит за длительность файла");
      await runFile(
        ffmpegPath,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-ss",
          String(start),
          "-i",
          input,
          "-t",
          String(end - start),
          "-vn",
          "-map",
          "0:a:0",
          "-c:a",
          "libmp3lame",
          "-b:a",
          "128k",
          output,
        ],
        { timeout: 120_000, maxBuffer: 1024 * 1024 },
      );
      const durationSeconds = await this.probeDuration(output);
      if (durationSeconds < 1.5 || durationSeconds > 31)
        throw new BadRequestException("Не удалось получить выбранный фрагмент");
      return await this.store("audio", await readFile(output), durationSeconds);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException("Не удалось обработать аудио. Проверь формат файла.");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async probeDuration(path: string): Promise<number> {
    let stderr = "";
    try {
      await runFile(ffmpegPath!, ["-hide_banner", "-i", path], {
        timeout: 15_000,
        maxBuffer: 64 * 1024,
      });
    } catch (error) {
      stderr = (error as Error & { stderr?: string }).stderr ?? "";
    }
    const match = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) throw new BadRequestException("Не удалось прочитать длительность аудио");
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }

  async exists(ref: MediaRef) {
    if (!(await this.repository.exists(ref))) return false;
    try {
      await access(this.path(ref));
      return true;
    } catch {
      return false;
    }
  }

  async resolve(ref: MediaRef): Promise<MediaRef | undefined> {
    const asset = await this.repository.find(ref);
    return asset && (await this.exists(ref)) ? asset : undefined;
  }

  async get(kind: string, id: string, range?: string) {
    if ((kind !== "image" && kind !== "video" && kind !== "audio") || !/^[0-9a-f-]{36}$/i.test(id))
      throw new NotFoundException("Медиафайл не найден");
    const ref: MediaRef = { kind, id };
    if (!(await this.exists(ref))) throw new NotFoundException("Медиафайл не найден");
    const path = this.path(ref);
    const size = (await stat(path)).size;
    const headers: Record<string, string> = {
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=86400, immutable",
    };
    let start = 0;
    let end = size - 1;
    let status = 200;
    if (range && kind !== "image") {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) throw new HttpException("Недопустимый диапазон", 416);
      if (match[1]) {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      } else {
        const suffix = Number(match[2]);
        start = Math.max(0, size - suffix);
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= size
      )
        throw new HttpException("Недопустимый диапазон", 416);
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    const length = end - start + 1;
    headers["Content-Length"] = String(length);
    return {
      status,
      headers,
      file: new StreamableFile(createReadStream(path, { start, end }), {
        type: kind === "image" ? "image/webp" : kind === "audio" ? "audio/mpeg" : "video/mp4",
        disposition: "inline",
        length,
      }),
    };
  }

  limits() {
    return {
      imageMaxBytes: this.config.getOrThrow<number>("MEDIA_IMAGE_MAX_BYTES"),
      videoMaxBytes: this.config.getOrThrow<number>("MEDIA_VIDEO_MAX_BYTES"),
      audioMaxBytes: this.config.getOrThrow<number>("MEDIA_AUDIO_MAX_BYTES"),
    };
  }

  private validate(
    file: Express.Multer.File | undefined,
    kind: MediaKind,
  ): asserts file is Express.Multer.File {
    if (!file) throw new BadRequestException("Выбери файл");
    const { imageMaxBytes, videoMaxBytes, audioMaxBytes } = this.limits();
    if (
      file.size >
      (kind === "image" ? imageMaxBytes : kind === "audio" ? audioMaxBytes : videoMaxBytes)
    )
      throw new PayloadTooLargeException("Превышен размер файла");
    if (
      !(kind === "image" ? imageTypes : kind === "audio" ? audioTypes : videoTypes).has(
        file.mimetype,
      )
    )
      throw new UnsupportedMediaTypeException("Неподдерживаемый формат файла");
  }

  private async store(kind: MediaKind, bytes: Buffer, durationSeconds?: number): Promise<MediaRef> {
    const ref: MediaRef = { id: randomUUID(), kind, durationSeconds };
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `${ref.id}.tmp`);
    await writeFile(temporary, bytes);
    await rename(temporary, this.path(ref));
    try {
      await this.repository.create(ref, bytes.length);
    } catch (error) {
      await rm(this.path(ref), { force: true });
      throw error;
    }
    return ref;
  }

  private path(ref: MediaRef) {
    return join(
      this.directory,
      `${ref.id}.${ref.kind === "image" ? "webp" : ref.kind === "audio" ? "mp3" : "mp4"}`,
    );
  }
}
