import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface LandmarksPayload {
  image_width: number;
  image_height: number;
  points: Array<{ x: number; y: number }>;
}

interface FaceExtractResponse {
  views: Array<{
    view: string;
    detected: boolean;
    landmarks_2d: Array<{ x: number; y: number }>;
    image_size: [number, number] | null;
  }>;
}

interface PoseExtractResponse {
  detected: boolean;
  body: Record<string, { x: number; y: number }>;
}

export interface DressTemplatePayload {
  canonical: Buffer;
  mimetype: string;
  landmarks: Record<string, unknown>;
}

export interface ScarfSpec {
  // Free-form id so new tying styles can be added without touching
  // this file. Legacy jobs sent 'classical' / 'loose' / 'double'.
  tyingStyle: string;
  // Optional textual prompt forwarded to the Python compositor so it
  // can condition its diffusion model on the exact drape wanted.
  tyingPrompt?: string;
  colorHex: string;
  pattern?: 'solid' | 'silk' | 'chiffon';
  accentHex?: string | null;
  opacity?: number;
}

export interface ScarfTemplatePayload {
  canonical: Buffer;
  mimetype: string; // 'image/png'
  landmarks: Record<string, unknown>;
}

@Injectable()
export class MlCompositorClient {
  private readonly logger = new Logger(MlCompositorClient.name);
  private readonly faceBase: string;
  private readonly composerBase: string;

  constructor(private readonly config: ConfigService) {
    this.faceBase = config.get<string>('ML_FACE_URL') ?? 'http://localhost:5001';
    this.composerBase = config.get<string>('ML_COMPOSITOR_URL') ?? 'http://localhost:5002';
  }

  /**
   * Buyer-side face swap. Takes a pre-styled mannequin image (seller-prepared)
   * and the buyer's selfie, returns the mannequin with the buyer's face
   * swapped in. ml-compositor runs the detection internally so this method
   * stays a thin proxy.
   */
  async composeFaceSwap(
    mannequin: { buffer: Buffer; mimetype: string; filename?: string },
    user: Express.Multer.File,
  ): Promise<Buffer> {
    const body = new FormData();
    body.append(
      'mannequin',
      new Blob([new Uint8Array(mannequin.buffer)], { type: mannequin.mimetype }),
      mannequin.filename || 'mannequin.jpg',
    );
    body.append(
      'user',
      new Blob([new Uint8Array(user.buffer)], { type: user.mimetype }),
      user.originalname || 'user.jpg',
    );

    const started = Date.now();
    const res = await fetch(`${this.composerBase}/compose/faceswap`, {
      method: 'POST',
      body,
    });
    const elapsed = Date.now() - started;

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.warn(`ml-compositor faceswap ${res.status}: ${txt}`);
      // 422 → surface detail (NO_USER_FACE / NO_MANNEQUIN_FACE) so the mobile
      // client can show a precise message. Everything else is a 500.
      if (res.status === 422) {
        throw new InternalServerErrorException({
          code: 'FACESWAP_UNPROCESSABLE',
          detail: txt,
        });
      }
      throw new InternalServerErrorException({ code: 'FACESWAP_FAILED', upstream: res.status });
    }

    const arrayBuffer = await res.arrayBuffer();
    this.logger.log(`faceswap composed in ${elapsed}ms`);
    return Buffer.from(arrayBuffer);
  }

  /**
   * Same input/output as composeFaceSwap, but goes through FaceFusion
   * (occlusion-aware swapper + GFPGAN enhancer). ~4-6 s per call on CPU
   * once the models are cached. Produces a much cleaner result than the
   * raw InsightFace path, so this is the primary swap and the old route
   * is kept only as a fallback.
   */
  async composeFacefusion(
    mannequin: { buffer: Buffer; mimetype: string; filename?: string },
    user: Express.Multer.File,
    opts: { enhance?: boolean } = {},
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const body = new FormData();
    body.append(
      'mannequin',
      new Blob([new Uint8Array(mannequin.buffer)], { type: mannequin.mimetype }),
      mannequin.filename || 'mannequin.jpg',
    );
    body.append(
      'user',
      new Blob([new Uint8Array(user.buffer)], { type: user.mimetype }),
      user.originalname || 'user.jpg',
    );
    body.append('enhance', String(opts.enhance ?? true));

    const started = Date.now();
    const res = await fetch(`${this.composerBase}/compose/facefusion`, {
      method: 'POST',
      body,
    });
    const elapsed = Date.now() - started;

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.warn(`ml-compositor facefusion ${res.status}: ${txt}`);
      if (res.status === 422) {
        throw new InternalServerErrorException({
          code: 'FACESWAP_UNPROCESSABLE',
          detail: txt,
        });
      }
      throw new InternalServerErrorException({
        code: 'FACEFUSION_FAILED',
        upstream: res.status,
      });
    }

    const arrayBuffer = await res.arrayBuffer();
    const rawCt = res.headers.get('content-type') ?? 'image/jpeg';
    const contentType = (rawCt.split(';')[0] ?? 'image/jpeg').trim();
    this.logger.log(`facefusion composed in ${elapsed}ms (${contentType})`);
    return { buffer: Buffer.from(arrayBuffer), contentType };
  }

  /**
   * One-off per user: crop their face out of the first facefusion swap as
   * a soft-oval RGBA PNG. The caller caches the stamp and feeds it to
   * composeFaceOverlay for every subsequent variant — one slow swap, N
   * cheap composites.
   */
  async composeFaceStamp(swapResult: Buffer): Promise<Buffer> {
    const body = new FormData();
    body.append(
      'image',
      new Blob([new Uint8Array(swapResult)], { type: 'image/jpeg' }),
      'swap.jpg',
    );
    const started = Date.now();
    const res = await fetch(`${this.composerBase}/compose/face-stamp`, {
      method: 'POST',
      body,
    });
    const elapsed = Date.now() - started;
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.warn(`ml-compositor face-stamp ${res.status}: ${txt}`);
      if (res.status === 422) {
        throw new InternalServerErrorException({ code: 'STAMP_NO_FACE', detail: txt });
      }
      throw new InternalServerErrorException({ code: 'STAMP_FAILED', upstream: res.status });
    }
    this.logger.log(`face-stamp cut in ${elapsed}ms`);
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Alpha-composite a cached face stamp onto a new mannequin. ~2 s on
   * CPU. Returns the composited JPEG, or throws FACESWAP_UNPROCESSABLE
   * if the mannequin has no detectable face (caller falls back to the
   * raw mannequin or triggers a real facefusion run).
   */
  async composeFaceOverlay(
    mannequin: { buffer: Buffer; mimetype: string; filename?: string },
    stamp: Buffer,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const body = new FormData();
    body.append(
      'mannequin',
      new Blob([new Uint8Array(mannequin.buffer)], { type: mannequin.mimetype }),
      mannequin.filename || 'mannequin.jpg',
    );
    body.append(
      'stamp',
      new Blob([new Uint8Array(stamp)], { type: 'image/png' }),
      'stamp.png',
    );
    const started = Date.now();
    const res = await fetch(`${this.composerBase}/compose/face-overlay`, {
      method: 'POST',
      body,
    });
    const elapsed = Date.now() - started;
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.warn(`ml-compositor face-overlay ${res.status}: ${txt}`);
      if (res.status === 422) {
        throw new InternalServerErrorException({ code: 'FACESWAP_UNPROCESSABLE', detail: txt });
      }
      throw new InternalServerErrorException({ code: 'OVERLAY_FAILED', upstream: res.status });
    }
    this.logger.log(`face-overlay composed in ${elapsed}ms`);
    const rawCt = res.headers.get('content-type') ?? 'image/jpeg';
    const contentType = (rawCt.split(';')[0] ?? 'image/jpeg').trim();
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType,
    };
  }

  async composeScarf(faceImage: Express.Multer.File, spec: ScarfSpec): Promise<Buffer> {
    const landmarks = await this.extractLandmarks(faceImage);

    const body = new FormData();
    body.append(
      'face',
      new Blob([new Uint8Array(faceImage.buffer)], { type: faceImage.mimetype }),
      faceImage.originalname || 'face.jpg',
    );
    body.append('landmarks', JSON.stringify(landmarks));
    body.append(
      'scarf',
      JSON.stringify({
        tying_style: spec.tyingStyle,
        tying_prompt: spec.tyingPrompt,
        color_hex: spec.colorHex,
        pattern: spec.pattern ?? 'silk',
        accent_hex: spec.accentHex ?? null,
        opacity: spec.opacity ?? 1.0,
      }),
    );

    const started = Date.now();
    const res = await fetch(`${this.composerBase}/compose/scarf`, {
      method: 'POST',
      body,
    });
    const elapsed = Date.now() - started;

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.error(`ml-compositor ${res.status}: ${txt}`);
      throw new InternalServerErrorException({ code: 'COMPOSE_FAILED', upstream: res.status });
    }

    const arrayBuffer = await res.arrayBuffer();
    this.logger.log(`composed scarf procedural (${spec.tyingStyle}, ${spec.colorHex}) in ${elapsed}ms`);
    return Buffer.from(arrayBuffer);
  }

  /**
   * Template-based scarf compose. Uses the stored garment_template from the DB
   * so the try-on shows the seller's real fabric instead of a procedural shape.
   */
  async composeScarfWithTemplate(
    faceImage: Express.Multer.File,
    spec: ScarfSpec,
    template: ScarfTemplatePayload,
  ): Promise<Buffer> {
    const landmarks = await this.extractLandmarks(faceImage);

    const body = new FormData();
    body.append(
      'face',
      new Blob([new Uint8Array(faceImage.buffer)], { type: faceImage.mimetype }),
      faceImage.originalname || 'face.jpg',
    );
    body.append(
      'template_canonical',
      new Blob([new Uint8Array(template.canonical)], { type: template.mimetype }),
      'canonical.png',
    );
    body.append('landmarks', JSON.stringify(landmarks));
    body.append('template_landmarks', JSON.stringify(template.landmarks));
    body.append(
      'scarf',
      JSON.stringify({
        tying_style: spec.tyingStyle,
        tying_prompt: spec.tyingPrompt,
        color_hex: spec.colorHex,
        pattern: spec.pattern ?? 'silk',
        opacity: spec.opacity ?? 1.0,
      }),
    );

    const started = Date.now();
    const res = await fetch(`${this.composerBase}/compose/scarf-template`, {
      method: 'POST',
      body,
    });
    const elapsed = Date.now() - started;

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.error(`ml-compositor template ${res.status}: ${txt}`);
      throw new InternalServerErrorException({
        code: 'TEMPLATE_COMPOSE_FAILED',
        upstream: res.status,
      });
    }

    const arrayBuffer = await res.arrayBuffer();
    this.logger.log(
      `composed scarf template (${spec.tyingStyle}, ${spec.colorHex}) in ${elapsed}ms`,
    );
    return Buffer.from(arrayBuffer);
  }

  private async extractLandmarks(image: Express.Multer.File): Promise<LandmarksPayload> {
    const form = new FormData();
    form.append(
      'front',
      new Blob([new Uint8Array(image.buffer)], { type: image.mimetype }),
      image.originalname || 'front.jpg',
    );

    const res = await fetch(`${this.faceBase}/face/extract`, { method: 'POST', body: form });
    if (!res.ok) {
      throw new InternalServerErrorException({
        code: 'LANDMARK_EXTRACTION_FAILED',
        upstream: res.status,
      });
    }
    const template = (await res.json()) as FaceExtractResponse;
    const front = template.views.find((v) => v.view === 'front' && v.detected);
    if (!front || !front.image_size) {
      throw new InternalServerErrorException({ code: 'NO_FACE_DETECTED' });
    }

    return {
      image_width: front.image_size[0],
      image_height: front.image_size[1],
      points: front.landmarks_2d.map((p) => ({ x: p.x, y: p.y })),
    };
  }

  private async extractPose(image: Express.Multer.File): Promise<Record<string, { x: number; y: number }>> {
    const form = new FormData();
    form.append(
      'image',
      new Blob([new Uint8Array(image.buffer)], { type: image.mimetype }),
      image.originalname || 'body.jpg',
    );
    const res = await fetch(`${this.faceBase}/face/pose`, { method: 'POST', body: form });
    if (!res.ok) {
      throw new InternalServerErrorException({
        code: 'POSE_EXTRACTION_FAILED',
        upstream: res.status,
      });
    }
    const payload = (await res.json()) as PoseExtractResponse;
    if (!payload.detected || !payload.body) {
      throw new InternalServerErrorException({ code: 'NO_POSE_DETECTED' });
    }
    return payload.body;
  }

  async composeDressWithTemplate(
    bodyImage: Express.Multer.File,
    spec: ScarfSpec,
    template: DressTemplatePayload,
  ): Promise<Buffer> {
    const bodyPose = await this.extractPose(bodyImage);

    const body = new FormData();
    body.append(
      'face',
      new Blob([new Uint8Array(bodyImage.buffer)], { type: bodyImage.mimetype }),
      bodyImage.originalname || 'body.jpg',
    );
    body.append(
      'template_canonical',
      new Blob([new Uint8Array(template.canonical)], { type: template.mimetype }),
      'canonical.png',
    );
    body.append('body_pose', JSON.stringify(bodyPose));
    body.append('template_landmarks', JSON.stringify(template.landmarks));
    body.append(
      'scarf',
      JSON.stringify({
        tying_style: spec.tyingStyle,
        tying_prompt: spec.tyingPrompt,
        color_hex: spec.colorHex,
        opacity: spec.opacity ?? 1.0,
      }),
    );

    const started = Date.now();
    const res = await fetch(`${this.composerBase}/compose/dress-template`, {
      method: 'POST',
      body,
    });
    const elapsed = Date.now() - started;

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.error(`ml-compositor dress ${res.status}: ${txt}`);
      throw new InternalServerErrorException({
        code: 'DRESS_COMPOSE_FAILED',
        upstream: res.status,
      });
    }

    this.logger.log(`composed dress template (${spec.colorHex}) in ${elapsed}ms`);
    return Buffer.from(await res.arrayBuffer());
  }
}
