import type { MetadataRoute } from "next";
import { SITE_URL, isProductionSite } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    ...(isProductionSite ? { sitemap: `${SITE_URL}/sitemap.xml` } : {}),
  };
}
