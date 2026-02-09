// Client-side image compression using Canvas API

export async function compressImage(file, maxWidth, maxHeight, maxSizeKB) {
  return new Promise((resolve, reject) => {
    // For GIFs, just check size (can't compress GIF with Canvas)
    if (file.type === 'image/gif') {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result.length / 1024 > maxSizeKB * 4) {
          reject(new Error(`GIF too large. Max ${maxSizeKB}KB`));
        } else {
          resolve(reader.result);
        }
      };
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');

        // Calculate dimensions maintaining aspect ratio
        let w = img.width;
        let h = img.height;
        if (w > maxWidth || h > maxHeight) {
          const ratio = Math.min(maxWidth / w, maxHeight / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        // Iteratively reduce quality until under maxSizeKB
        let quality = 0.9;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > maxSizeKB * 1370 && quality > 0.1) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        if (dataUrl.length > maxSizeKB * 1370) {
          reject(new Error(`Image too large even after compression. Max ${maxSizeKB}KB`));
        } else {
          resolve(dataUrl);
        }
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function compressAvatar(file) {
  return compressImage(file, 128, 128, 100);
}

export function compressBanner(file) {
  return compressImage(file, 600, 240, 300);
}

export function compressServerIcon(file) {
  return compressImage(file, 128, 128, 100);
}

export function compressServerBanner(file) {
  return compressImage(file, 600, 240, 300);
}
