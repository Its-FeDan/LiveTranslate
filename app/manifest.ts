import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Relay — Russian, understood",
    short_name: "Relay",
    description: "Live Russian to English translation.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0e0d",
    theme_color: "#c9ff46",
    orientation: "portrait",
  };
}
