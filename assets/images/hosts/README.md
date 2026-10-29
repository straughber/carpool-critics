# Host Media & Cutouts

Store host imagery and transparent PNG/WebP cutouts here:

- `Alex_CurbsideCritic.webp`: Driver seat host (Alex)
- `Dave_CurbsideCritic.webp`: Center back seat host (Dave)
- `Shane_CurbsideCritic.webp`: Passenger seat host (Shane)
- `alex.svg`, `dave.svg`, `shane.svg`: Transparent vector fallbacks

### Episode close-ups

`<HostName>_EP02_CloseUp.jpg` are the stills on the host bio cards. Each one is a
frame from Episode 2 (Club Kid) pulled off the 4K wide GoPro, undistorted through
`tools/lens_model.py`, and re-framed through `tools/virtual_camera.py` around that
host's measured seat anchor from the episode's
`spatial_framing_calibration.json` — so the three stills are the same night, the
same lens, and the same show as the episodes, not stock photography.

| File | Frame | Shot | Grade |
| --- | --- | --- | --- |
| `Alex_EP02_CloseUp.jpg` | 00:31:51 | driver seat, 1000px crop (4:5) | cabin contrast + saturation |
| `Shane_EP02_CloseUp.jpg` | 00:13:01 | passenger seat, 1000px crop (4:5) | cabin contrast + saturation |
| `Dave_EP02_CloseUp.jpg` | 00:02:13 | back seat, 740px crop (4:5) | cabin contrast + saturation |

Re-generate one with (from the workspace root, using the OpenCV env):

```bash
.venv/bin/python /tmp/render_hosts.py <Host> <seconds> <driver|passenger|backseat> <crop_w> out.jpg
```

The shot list is `tools/virtual_camera.py --shots`; do not hand-crop a host out of
the frame — the anchors and the lens correction are what make the still sit right.

### SEO Best Practice:
- Use consistent naming: `<HostName>_MediaDescriptor.ext`
- Maintain transparent backgrounds on cutouts so the vehicle interior lighting shines through cleanly.
