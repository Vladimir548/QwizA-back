import { Injectable } from "@nestjs/common";
@Injectable()
export class HealthService {
  getStatus() {
    return { status: "ok", service: "qwiza-api" } as const;
  }
}
