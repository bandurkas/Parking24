import type { MetadataRoute } from "next";

// Stage: полный запрет индексации. Перед боевым запуском заменить на allow + sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
