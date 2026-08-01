/**
 * Builds a URL for the custom `movie://` scheme, which main serves after
 * checking the path really sits inside a library root or the image cache.
 * Shared so main and renderer cannot encode it differently.
 */
export function toMovieUrl(absolutePath: string): string {
  return `movie://local/${encodeURIComponent(absolutePath)}`;
}
