-- Indexes for the queries that run on every webhook, every send and every tick.
-- Postgres does not index foreign keys on its own; without these the lookups
-- below scan the tenant's whole table.

-- Cal.com webhooks: the lead's latest booking.
CREATE INDEX "Booking_tenantId_leadId_createdAt_idx" ON "Booking"("tenantId", "leadId", "createdAt");

-- The per-recipient daily cap checked before every automated send.
CREATE INDEX "Message_tenantId_to_createdAt_idx" ON "Message"("tenantId", "to", "createdAt");

-- Finding the contact's thread on a channel when a message is recorded.
CREATE INDEX "Conversation_tenantId_channel_contactId_idx" ON "Conversation"("tenantId", "channel", "contactId");

-- Lapsed-customer detection (recent payments per contact) and payments against a lead.
CREATE INDEX "Transaction_contactId_status_occurredAt_idx" ON "Transaction"("contactId", "status", "occurredAt");

-- The once-per-person review-request throttle and per-contact history.
CREATE INDEX "AutomationRun_tenantId_contactId_typeKey_createdAt_idx" ON "AutomationRun"("tenantId", "contactId", "typeKey", "createdAt");

-- Quiet-quote detection by stage, and open leads per contact for the lapsed detector.
CREATE INDEX "Lead_tenantId_stageId_idx" ON "Lead"("tenantId", "stageId");
CREATE INDEX "Lead_contactId_status_idx" ON "Lead"("contactId", "status");

-- The reconciler: open items about a lead or a contact.
CREATE INDEX "MissedOpportunity_tenantId_leadId_status_idx" ON "MissedOpportunity"("tenantId", "leadId", "status");
CREATE INDEX "MissedOpportunity_tenantId_contactId_status_idx" ON "MissedOpportunity"("tenantId", "contactId", "status");
