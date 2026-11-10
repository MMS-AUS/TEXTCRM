/** PUT to a presigned URL with upload progress (fetch can't report upload progress). */
export function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', contentType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Storage refused the upload (${String(request.status)}).`));
    };
    request.onerror = () => {
      reject(new Error("Couldn't reach file storage. Check your connection and try again."));
    };
    request.send(body);
  });
}

/** Saves text the API produced (e.g. a CSV report) as a file in the browser. */
export function downloadText(text: string, fileName: string, type = 'text/csv;charset=utf-8') {
  saveBlob(new Blob([text], { type }), fileName);
}

/** Saves a binary file the API sent as base64 (e.g. an Excel template). */
export function downloadBase64(base64: string, fileName: string, type: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  saveBlob(new Blob([bytes], { type }), fileName);
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
