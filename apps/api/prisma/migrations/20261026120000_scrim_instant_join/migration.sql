-- Scrims no longer need manager approval: teams join confirmed on the lowest free slot (services/registrations.ts).
-- Requests still PENDING on today's or later sessions are approved the same way, oldest request first; any that
-- don't fit are cancelled (not rejected: REJECTED now means "removed by the organiser" and blocks rejoining).
-- Pending requests on past sessions are cancelled too (approving them would add teams to matches they never played).

WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d),
pend AS (
  SELECT r.id, r."sessionId", row_number() OVER (PARTITION BY r."sessionId" ORDER BY r."createdAt", r.id) AS n
  FROM "Registration" r
  JOIN "ScrimSession" ss ON ss.id = r."sessionId"
  WHERE r.status = 'PENDING' AND ss.date >= (SELECT d FROM today)
),
free AS (
  SELECT ss.id AS "sessionId", g.slot, row_number() OVER (PARTITION BY ss.id ORDER BY g.slot) AS n
  FROM "ScrimSession" ss
  JOIN "Scrim" sc ON sc.id = ss."scrimId"
  CROSS JOIN LATERAL generate_series(sc."firstSlot", sc."firstSlot" + sc."slotCount" - 1) AS g(slot)
  WHERE ss.id IN (SELECT "sessionId" FROM pend)
    AND NOT EXISTS (
      SELECT 1 FROM "Registration" a WHERE a."sessionId" = ss.id AND a.status = 'APPROVED' AND a."slotNumber" = g.slot
    )
)
UPDATE "Registration" r
SET status = 'APPROVED', "slotNumber" = f.slot, "decidedAt" = now(), "rejectionReason" = NULL
FROM pend p
JOIN free f ON f."sessionId" = p."sessionId" AND f.n = p.n
WHERE r.id = p.id;

UPDATE "Registration" r
SET status = 'CANCELLED', "slotNumber" = NULL, "decidedAt" = now(),
    "rejectionReason" = CASE
      WHEN ss.date >= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'All slots were taken'
      ELSE 'Not approved before the scrim started'
    END
FROM "ScrimSession" ss
WHERE ss.id = r."sessionId" AND r.status = 'PENDING';
