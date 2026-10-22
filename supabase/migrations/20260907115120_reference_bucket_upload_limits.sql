-- Applied to production as version 20260907115120 (reference_bucket_upload_limits).
-- Content exported verbatim from supabase_migrations.schema_migrations.

update storage.buckets set file_size_limit = 62914560, allowed_mime_types = array['image/jpeg','image/png','image/webp','audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/aac','audio/ogg','audio/flac'] where id = 'cinexvideo-references';
