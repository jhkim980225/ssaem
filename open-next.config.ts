// Cloudflare Workers 배포 어댑터 설정. ISR·next/image를 안 써서 R2 캐시 없이 기본값으로 충분하다
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
