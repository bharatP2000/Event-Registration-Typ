Drop your event background photo here as:

    background.jpg

That's it — no code changes needed. style.css references assets/background.jpg
with a dark gradient overlay on top of it (for text readability) and a plain
gradient underneath as a fallback. If background.jpg is missing, the browser
just fails to paint that one layer and the fallback gradient shows through
automatically, so the page never breaks or shows a broken-image icon.

Recommended: a landscape photo at least 1920x1080, JPG or WEBP, under ~500KB
for fast loading.
