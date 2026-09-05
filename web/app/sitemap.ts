import type { MetadataRoute } from "next";
import { SITE_URL, isProductionSite } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return isProductionSite ? ["", "/history", "/stats", "/about", "/edge"].map((path) => ({ url: `${SITE_URL}${path}` })) : [];
}
