/**
 * product-image-service.ts
 * Controle de Validades | Skalee
 * Camada de serviço agnóstica para busca externa de imagens de referência por código de barras / EAN.
 */

(() => {
  const isDev = typeof window !== "undefined" && Boolean(
    window.location?.hostname === "localhost" ||
    window.location?.hostname === "127.0.0.1" ||
    window.location?.hostname?.endsWith(".local")
  );

  function cleanBarcode(value: string | number | null | undefined): string {
    return String(value || "").trim().replace(/\D/g, "");
  }

  function isValidBarcode(value: string): boolean {
    return Boolean(value && value.length >= 6 && value.length <= 14);
  }

  function validateImageUrl(rawUrl: string): string | null {
    const trimmed = String(rawUrl || "").trim();
    if (!trimmed) return null;
    if (!/^https?:\/\//i.test(trimmed)) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      return parsed.href;
    } catch {
      return null;
    }
  }

  async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = 6000): Promise<Response> {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const fetchFn = typeof fetch !== "undefined" ? fetch : null;
      if (!fetchFn) throw new Error("fetch is not available in current environment");

      const response = await fetchFn(url, {
        ...options,
        signal: controller ? controller.signal : undefined
      });
      return response;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  const providers: ProductImageProvider[] = [
    {
      name: "openfoodfacts",
      async search(code: string): Promise<ProductImageSearchResult | null> {
        try {
          const fields = "code,image_front_url,image_url,image_front_small_url,product_name";
          const url = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(code)}?fields=${encodeURIComponent(fields)}&product_type=all&lc=pt&cc=br`;
          const response = await fetchWithTimeout(url, {
            headers: { Accept: "application/json" }
          }, 6000);

          if (!response.ok) return null;
          const payload = await response.json();
          const product = payload?.product;
          if (!product) return null;

          const rawUrl = product.image_front_url || product.image_url || product.image_front_small_url || "";
          const safeUrl = validateImageUrl(rawUrl);
          if (!safeUrl) return null;

          return {
            found: true,
            imageUrl: safeUrl,
            provider: "openfoodfacts"
          };
        } catch (error) {
          if (isDev) {
            console.warn("[productImageService] Falha na consulta OpenFoodFacts:", error);
          }
          return null;
        }
      }
    },
    {
      name: "upcitemdb",
      async search(code: string): Promise<ProductImageSearchResult | null> {
        try {
          const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`;
          const response = await fetchWithTimeout(url, {
            headers: { Accept: "application/json" }
          }, 6000);

          if (response.status === 404 || !response.ok) return null;
          const payload = await response.json();
          if (payload?.code !== "OK" || !Array.isArray(payload?.items) || !payload.items.length) {
            return null;
          }

          const item = payload.items[0];
          const rawUrl = (Array.isArray(item?.images) && item.images[0]) || item?.image || "";
          const safeUrl = validateImageUrl(rawUrl);
          if (!safeUrl) return null;

          return {
            found: true,
            imageUrl: safeUrl,
            provider: "upcitemdb"
          };
        } catch (error) {
          if (isDev) {
            console.warn("[productImageService] Falha na consulta UPCItemDB:", error);
          }
          return null;
        }
      }
    }
  ];

  const productImageService: ProductImageService = {
    async findProductImageByBarcode(barcode: string): Promise<ProductImageSearchResult> {
      const code = cleanBarcode(barcode);
      if (!isValidBarcode(code)) {
        return { found: false, imageUrl: null, provider: null };
      }

      for (const provider of providers) {
        try {
          const result = await provider.search(code);
          if (result && result.found && result.imageUrl) {
            if (isDev) {
              console.log(`[productImageService] Imagem encontrada via ${provider.name} para EAN ${code}:`, result.imageUrl);
            }
            return result;
          }
        } catch (err) {
          if (isDev) {
            console.warn(`[productImageService] Provedor ${provider.name} falhou:`, err);
          }
        }
      }

      return { found: false, imageUrl: null, provider: null };
    },

    registerProvider(provider: ProductImageProvider): void {
      if (!provider || !provider.name || typeof provider.search !== "function") return;
      providers.push(provider);
    }
  };

  if (typeof window !== "undefined") {
    window.productImageService = productImageService;
  }

  if (typeof globalThis !== "undefined") {
    (globalThis as unknown as { productImageService: ProductImageService }).productImageService = productImageService;
  }
})();

