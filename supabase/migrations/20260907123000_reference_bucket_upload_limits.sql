-- Keep storage enforcement aligned with /api/uploads. The bucket-wide limit is
-- the larger audio cap; the API applies the stricter 15 MB cap to images.
update storage.buckets
set file_size_limit = 62914560,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/mp4',
      'audio/aac',
      'audio/ogg',
      'audio/flac'
    ]
where id = 'cinexvideo-references';
