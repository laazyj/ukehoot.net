# YouTube watermarks

Branding watermarks for the UkeHoot YouTube channel, generated from
`packages/site/static/logo-white.svg`. These are brand assets, not part of the
published site.

Upload in YouTube Studio: **Customisation → Branding → Video watermark**.

All meet YouTube's spec: square PNG, transparent background, under 1 MB.
Rendered at 512×512 (YouTube's recommended minimum is 150×150) so they stay
crisp after downscaling. The watermark shows small in the bottom-right corner
over arbitrary footage, so contrast on both light and dark video matters.

| File                       | Look                                 | Best for                                                              |
| -------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| `watermark-white.png`      | Plain white logo                     | Cleanest. Reads on dark footage, vanishes on bright footage.          |
| `watermark-white-halo.png` | White logo with a soft dark halo     | Most robust: legible on both light and dark footage. **Recommended.** |
| `watermark-badge.png`      | White logo on the dark rounded badge | Strongest contrast, always visible, but a heavier corner block.       |
