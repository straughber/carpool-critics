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

### Isolated headshots (#about cards)

The bio cards use `*_EP02_Headshot.jpg` — 900x1125 (4:5), cut out with a real
person silhouette and composited on asphalt `#0A0A0C`, so no stray arm, seat or
neighbour is in the frame. The matte is `tools/vision_matte.hero_matte()` (macOS
Vision person segmentation intersected with a column around that seat's measured
face anchor); there is no ellipse and no hand-cut path.

| File | Frame | Why this frame |
| --- | --- | --- |
| `Alex_EP02_Headshot.jpg` | 00:10:52 | smiling mid-take, mic in hand |
| `Shane_EP02_Headshot.jpg` | 00:14:38 | a genuine laugh (measured laugh peak 877.9s) |
| `Dave_EP02_Headshot.jpg` | 00:02:14 | his warmest frame in the sampled set; he rarely smiles on tape |

Candidates come from the episode's measured laugh peaks
(`02_Transcription/<Episode>_energy_index.json` → `laugh_windows`), two offsets
each. A frame only becomes a candidate if Vision's person mask covers **≥85% of
that host's face box** — on a dark cabin Vision sometimes returns a mask that
omits a whole head (EP02 t=1670 does exactly this for Alex), and a frame where the
host is not segmented cannot be cut out honestly. The coverage check is what
rejects it instead of shipping a hole.

The 2026-10-31 run also fixed the bridge: `vision_matte` passed an empty
`NSDictionary` as handler options, which raises `NSInvalidArgumentException` on
this PyObjC, and the exception escaped into `subject_isolation`'s fallback — so
every "real silhouette" before that date was the ellipse. Both call sites now pass
`None` and a bridge failure returns `None` rather than raising.
