import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return { name: "PR Territorios", short_name: "PR Territorios", description: "Planificación y gestión de territorios.", start_url: "/", display: "standalone", background_color: "#f8fafc", theme_color: "#1e3a5f", icons: [{ src: "/PR.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }] };
}
