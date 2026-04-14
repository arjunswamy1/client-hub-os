DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public can read campaign build files by path'
  ) THEN
    DROP POLICY "Public can read campaign build files by path" ON storage.objects;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public can view campaign build files'
  ) THEN
    CREATE POLICY "Public can view campaign build files"
    ON storage.objects
    FOR SELECT
    USING (bucket_id = 'campaign-build-files');
  END IF;
END $$;