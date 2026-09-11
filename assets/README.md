# Curbside Cinema Assets Guide

### 1. Car Background Image
Upload your high-res background image as:
- `CurbsideCinema_Background.jpeg` (or `.jpg`) into the **root folder** of this repository.
The website's `index.html` and `style.css` are configured to display it automatically.

### 2. Host Button Images
The repository includes three SVG placeholders in this `assets/` folder:
- `assets/shane.svg`: Shane (Driver Seat, Left) -> Links to Contact Us
- `assets/alex.svg`: Alex (Center Back Seat, Middle) -> Links to About Us
- `assets/dave.svg`: Dave (Passenger Seat, Right) -> Links to Episodes

#### Replacing With Real Transparent PNG Cutouts:
To use real photo cutouts of the hosts:
1. Cut out Shane, Alex, and Dave from your theater photo from the hips up (with a transparent background).
2. Save them as:
   - `assets/shane.png`
   - `assets/alex.png`
   - `assets/dave.png`
3. Upload them into this `assets/` folder. The `index.html` file includes an automatic `onerror` fallback that will immediately display the PNGs in place of the SVGs!
