UPDATE items AS target
JOIN (
  SELECT
    id,
    serial_no,
    ROW_NUMBER() OVER (PARTITION BY serial_no ORDER BY created_at, id) AS duplicate_rank
  FROM items
) AS ranked ON ranked.id = target.id
SET target.serial_no = CONCAT(target.serial_no, '-DUP-', ranked.duplicate_rank - 1)
WHERE ranked.duplicate_rank > 1;

ALTER TABLE items ADD UNIQUE KEY uniq_items_serial_no (serial_no);
