from __future__ import annotations

import argparse
import base64
import io
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
REPORTS_DIR = ROOT / "reports"
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://scetuqugfbhozikridaw.supabase.co").rstrip("/")
SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET = "validity-photos"
MAX_IMAGE_SIDE = 1280
TARGET_MAX_BYTES = 400 * 1024
MAX_ERROR_BODY_CHARS = 4096
SAFE_HEADER_NAMES = {
    "cache-control",
    "cf-ray",
    "content-length",
    "content-type",
    "date",
    "server",
    "vary",
    "x-content-type-options",
    "x-envoy-upstream-service-time",
    "x-kong-proxy-latency",
    "x-kong-upstream-latency",
    "x-request-id",
    "x-sb-error-code",
    "x-sb-project-ref",
}


@dataclass
class PreparedImage:
    data: bytes
    mime_type: str
    extension: str


class SafeHttpError(RuntimeError):
    def __init__(
        self,
        *,
        method: str,
        path: str,
        code: int,
        reason: str,
        headers: dict[str, str],
        body: str,
        context: dict[str, object] | None = None,
    ) -> None:
        self.method = method
        self.path = path
        self.code = code
        self.reason = reason
        self.headers = headers
        self.body = body
        self.context = context or {}
        super().__init__(f"HTTP {code} {reason} em {method} {path}")

    def to_report(self) -> dict[str, object]:
        return {
            "message": str(self),
            "http": {
                "method": self.method,
                "path": self.path,
                "code": self.code,
                "reason": self.reason,
                "headers": self.headers,
                "body": self.body,
                "context": self.context,
            },
        }


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def auth_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    if not SERVICE_ROLE_KEY:
        raise RuntimeError("Defina SUPABASE_SERVICE_ROLE_KEY antes de executar a migração.")
    headers = {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    }
    if extra:
        headers.update(extra)
    return headers


def safe_response_headers(headers) -> dict[str, str]:
    safe: dict[str, str] = {}
    for key, value in dict(headers).items():
        normalized = key.lower()
        if normalized in SAFE_HEADER_NAMES:
            safe[key] = str(value)
    return safe


def redact_text(value: str) -> str:
    redacted = value
    redacted = redacted.replace(SERVICE_ROLE_KEY, "[REDACTED_SERVICE_ROLE]") if SERVICE_ROLE_KEY else redacted
    redacted = redacted.replace("sb_publishable_RUy69LJc14uWrn0H9WgvKQ_ebicHtdN", "[REDACTED_PUBLISHABLE_KEY]")
    redacted = redacted.replace(SUPABASE_URL, "[REDACTED_SUPABASE_URL]")
    redacted = re.sub(r"data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+", "[REDACTED_DATA_URL]", redacted)
    redacted = re.sub(r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}", "[REDACTED_JWT]", redacted)
    return redacted[:MAX_ERROR_BODY_CHARS]


def safe_error_body(error: urllib.error.HTTPError) -> str:
    try:
        raw = error.read()
    except Exception as read_error:
        return f"[could not read error body: {read_error}]"
    if not raw:
        return ""
    text = raw.decode("utf-8", errors="replace")
    return redact_text(text)


def raise_safe_http_error(
    error: urllib.error.HTTPError,
    *,
    method: str,
    path: str,
    context: dict[str, object] | None = None,
) -> None:
    raise SafeHttpError(
        method=method,
        path=path,
        code=error.code,
        reason=error.reason,
        headers=safe_response_headers(error.headers),
        body=safe_error_body(error),
        context=context,
    ) from error


def request_json(
    method: str,
    path: str,
    body: object | None = None,
    headers: dict[str, str] | None = None,
    context: dict[str, object] | None = None,
):
    payload = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{SUPABASE_URL}{path}",
        data=payload,
        method=method,
        headers=auth_headers({
            "Content-Type": "application/json",
            **(headers or {}),
        }),
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            data = response.read()
            if not data:
                return None
            return json.loads(data.decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise_safe_http_error(error, method=method, path=path, context=context)


def request_bytes(
    method: str,
    path: str,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    context: dict[str, object] | None = None,
):
    request_headers = headers or {}
    if data is not None:
        request_headers = {
            "Content-Length": str(len(data)),
            **request_headers,
        }
    req = urllib.request.Request(
        f"{SUPABASE_URL}{path}",
        data=data,
        method=method,
        headers=auth_headers(request_headers),
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        raise_safe_http_error(error, method=method, path=path, context=context)


def object_path(row: dict, extension: str) -> str:
    return f"{row['user_id']}/{row['id']}/photo.{extension}"


def storage_object_url(path: str) -> str:
    return f"/storage/v1/object/{BUCKET}/{urllib.parse.quote(path, safe='/')}"


def storage_list_url() -> str:
    return f"/storage/v1/object/list/{BUCKET}"


def split_object_name(path: str) -> tuple[str, str]:
    folder, _, file_name = path.rpartition("/")
    return folder, file_name


def list_objects(prefix: str) -> list[dict]:
    return request_json(
        "POST",
        storage_list_url(),
        {
            "prefix": prefix,
            "limit": 100,
            "offset": 0,
            "sortBy": {"column": "name", "order": "asc"},
        },
        context={"prefix": prefix},
    ) or []


def object_exists(path: str) -> tuple[bool, int]:
    folder, file_name = split_object_name(path)
    for item in list_objects(folder):
        if item.get("name") != file_name:
            continue
        metadata = item.get("metadata") or {}
        size = int(metadata.get("size") or item.get("size") or 0)
        return True, size
    return False, 0


def upload_object(path: str, image: PreparedImage) -> None:
    upload_headers = {
        "Content-Type": image.mime_type,
        "Cache-Control": "31536000",
        "x-upsert": "false",
    }
    request_bytes(
        "POST",
        storage_object_url(path),
        image.data,
        upload_headers,
        {
            "object_name": path,
            "mime_type": image.mime_type,
            "extension": image.extension,
            "content_length": len(image.data),
            "request_headers": {
                "Content-Type": upload_headers["Content-Type"],
                "Content-Length": str(len(image.data)),
                "Cache-Control": upload_headers["Cache-Control"],
                "x-upsert": upload_headers["x-upsert"],
            },
        },
    )


def update_photo_path(product_id: str, path: str) -> None:
    encoded_id = urllib.parse.quote(product_id)
    request_json(
        "PATCH",
        f"/rest/v1/validity_products?id=eq.{encoded_id}",
        {"photo_path": path},
        {"Prefer": "return=minimal"},
        {"product_id": product_id, "photo_path": path},
    )


def fetch_products(offset: int, limit: int) -> list[dict]:
    query = urllib.parse.urlencode({
        "select": "id,user_id,photo,photo_path",
        "order": "created_at.asc",
        "limit": str(limit),
        "offset": str(offset),
    })
    return request_json("GET", f"/rest/v1/validity_products?{query}") or []


def classify_photo(value: str) -> str:
    if not value:
        return "empty"
    if value.startswith("data:image/") and ";base64," in value[:80]:
        return "data_url"
    if value.startswith("http://") or value.startswith("https://"):
        return "url"
    return "text"


def decode_photo(value: str) -> tuple[bytes, str]:
    kind = classify_photo(value)
    if kind != "data_url":
        raise ValueError(f"Tipo de foto legado não suportado para migração automática: {kind}")
    header, encoded = value.split(",", 1)
    mime_type = header.removeprefix("data:").split(";", 1)[0].strip().lower()
    return base64.b64decode(encoded, validate=True), mime_type


def save_image(image: Image.Image, mime_type: str, quality: int) -> PreparedImage:
    buffer = io.BytesIO()
    if mime_type == "image/webp":
        image.save(buffer, format="WEBP", quality=quality, method=6)
        return PreparedImage(buffer.getvalue(), "image/webp", "webp")
    image.save(buffer, format="JPEG", quality=quality, optimize=True, progressive=True)
    return PreparedImage(buffer.getvalue(), "image/jpeg", "jpg")


def prepare_image(raw: bytes) -> PreparedImage:
    with Image.open(io.BytesIO(raw)) as opened:
        image = ImageOps.exif_transpose(opened)
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        elif image.mode == "L":
            image = image.convert("RGB")

        side = MAX_IMAGE_SIDE
        best: PreparedImage | None = None
        for _attempt in range(4):
            resized = image.copy()
            resized.thumbnail((side, side), Image.Resampling.LANCZOS)
            for quality in (82, 76, 70, 64, 58, 52):
                try:
                    candidate = save_image(resized, "image/webp", quality)
                except Exception:
                    candidate = save_image(resized, "image/jpeg", quality)
                best = candidate
                if len(candidate.data) <= TARGET_MAX_BYTES:
                    return candidate
            side = round(side * 0.82)

        if best is None:
            raise ValueError("Não foi possível otimizar a imagem.")
        return best


def migrate(args: argparse.Namespace) -> dict:
    summary = {
        "started_at": now_iso(),
        "dry_run": args.dry_run,
        "batch_size": args.batch_size,
        "total_found": 0,
        "total_with_legacy_photo": 0,
        "total_migrated": 0,
        "total_already_migrated": 0,
        "total_skipped_empty": 0,
        "total_error": 0,
        "bytes_previous": 0,
        "bytes_sent_to_storage": 0,
        "pending_records": [],
        "errors": [],
    }

    offset = 0
    while True:
        rows = fetch_products(offset, args.batch_size)
        if not rows:
            break
        offset += len(rows)

        for row in rows:
            product_id = row["id"]
            photo = row.get("photo") or ""
            photo_path = row.get("photo_path") or ""
            summary["total_found"] += 1
            summary["bytes_previous"] += len(photo.encode("utf-8"))

            try:
                if not photo:
                    summary["total_skipped_empty"] += 1
                    continue

                summary["total_with_legacy_photo"] += 1

                if photo_path:
                    exists, size = object_exists(photo_path)
                    if not exists or size <= 0:
                        raise RuntimeError(f"photo_path existente sem objeto válido: {photo_path}")
                    summary["total_already_migrated"] += 1
                    summary["bytes_sent_to_storage"] += size
                    continue

                raw, _source_mime = decode_photo(photo)
                image = prepare_image(raw)
                path = object_path(row, image.extension)

                exists, existing_size = object_exists(path)
                if exists and existing_size > 0:
                    if not args.dry_run:
                        update_photo_path(product_id, path)
                    summary["total_already_migrated"] += 1
                    summary["bytes_sent_to_storage"] += existing_size
                    continue

                if not args.dry_run:
                    upload_object(path, image)
                    confirmed, confirmed_size = object_exists(path)
                    if not confirmed or confirmed_size <= 0:
                        raise RuntimeError(f"Upload não confirmado para {path}")
                    update_photo_path(product_id, path)
                    summary["bytes_sent_to_storage"] += confirmed_size
                else:
                    summary["bytes_sent_to_storage"] += len(image.data)

                summary["total_migrated"] += 1
                time.sleep(args.pause)
            except Exception as error:
                summary["total_error"] += 1
                summary["pending_records"].append(product_id)
                error_report = {
                    "id": product_id,
                    "photo_path": photo_path,
                    "message": str(error),
                }
                if isinstance(error, SafeHttpError):
                    error_report.update(error.to_report())
                summary["errors"].append(error_report)
                if args.stop_on_error:
                    summary["finished_at"] = now_iso()
                    return summary

        if args.limit and summary["total_found"] >= args.limit:
            break

    summary["finished_at"] = now_iso()
    return summary


def write_report(summary: dict) -> Path:
    REPORTS_DIR.mkdir(exist_ok=True)
    report_path = REPORTS_DIR / "validity-photo-migration-report.json"
    report_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return report_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Migra fotos Base64 de validity_products para Supabase Storage privado.")
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--pause", type=float, default=0.1)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--stop-on-error", action="store_true", default=True)
    args = parser.parse_args()

    if args.batch_size < 1 or args.batch_size > 50:
        raise SystemExit("--batch-size deve ficar entre 1 e 50.")

    try:
        summary = migrate(args)
    except Exception as error:
        print(f"ERRO: {error}", file=sys.stderr)
        return 1

    report_path = write_report(summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"Relatório: {report_path}")
    return 1 if summary["total_error"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
