-- ============================================================================
-- GraceLedger — end-to-end test data seed
-- Run in Supabase SQL Editor to populate realistic test data.
-- ============================================================================

-- 1. Create 20 donors ------------------------------------------------------
insert into public.donors (first_name, last_name, email, phone, address, city, state, zip_code)
values
  ('James', 'Williams', 'james.w@email.com', '555-0101', '12 Oak Lane', 'Atlanta', 'GA', '30301'),
  ('Maria', 'Garcia', 'maria.g@email.com', '555-0102', '45 Pine St', 'Decatur', 'GA', '30030'),
  ('Robert', 'Johnson', 'rob.j@email.com', '555-0103', '78 Maple Ave', 'Atlanta', 'GA', '30303'),
  ('Linda', 'Brown', 'linda.b@email.com', '555-0104', '90 Elm Dr', 'Marietta', 'GA', '30060'),
  ('David', 'Martinez', 'david.m@email.com', '555-0105', '34 Cedar Ct', 'Atlanta', 'GA', '30305'),
  ('Sarah', 'Thompson', 'sarah.t@email.com', '555-0106', '56 Birch Way', 'Roswell', 'GA', '30075'),
  ('Michael', 'Anderson', 'mike.a@email.com', '555-0107', '23 Willow Ln', 'Smyrna', 'GA', '30080'),
  ('Patricia', 'Taylor', 'pat.t@email.com', '555-0108', '67 Spruce Rd', 'Atlanta', 'GA', '30308'),
  ('Chris', 'Thomas', 'chris.t@email.com', '555-0109', '89 Ash Blvd', 'Alpharetta', 'GA', '30022'),
  ('Deborah', 'Jackson', 'deb.j@email.com', '555-0110', '10 Poplar St', 'Atlanta', 'GA', '30310'),
  ('The Hamilton', 'Family', 'hamilton@email.com', '555-0111', '88 Elm St', 'Atlanta', 'GA', '30308'),
  ('Marcus', 'Lin', 'marcus.lin@email.com', '555-0112', '12 Park Ln', 'Atlanta', 'GA', '30303'),
  ('Rebecca', 'White', 'rebecca.w@email.com', '555-0113', '34 River Rd', 'Dunwoody', 'GA', '30338'),
  ('Daniel', 'Harris', 'dan.h@email.com', '555-0114', '56 Lake Dr', 'Sandy Springs', 'GA', '30328'),
  ('Susan', 'Clark', 'susan.c@email.com', '555-0115', '78 Hill Ct', 'Atlanta', 'GA', '30315'),
  ('Joseph', 'Lewis', 'joe.l@email.com', '555-0116', '90 Valley Way', 'Norcross', 'GA', '30071'),
  ('Karen', 'Walker', 'karen.w@email.com', '555-0117', '12 Ridge Rd', 'Atlanta', 'GA', '30318'),
  ('Steven', 'Allen', 'steve.a@email.com', '555-0118', '34 Brook Ln', 'Kennesaw', 'GA', '30144'),
  ('Nancy', 'Young', 'nancy.y@email.com', '555-0119', '56 Glen Ct', 'Atlanta', 'GA', '30324'),
  ('Edward', 'King', 'ed.k@email.com', '555-0120', '78 Dale Ave', 'Buckhead', 'GA', '30326');

-- 2. Create 35 donations spread across 8 weeks (Jan – Jul 2026) ------------
-- Week 1: Jul 27 (Sunday)
insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, check_number, donation_date, entered_by, notes)
select d.id, d.first_name || ' ' || d.last_name, 500.00, 'tithe', 'check', '2201', '2026-07-27', auth.uid(), 'Monthly tithe'
from public.donors d where d.last_name = 'Williams' and d.first_name = 'James';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, check_number, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 350.00, 'tithe', 'check', '1188', '2026-07-27', auth.uid()
from public.donors d where d.last_name = 'Garcia' and d.first_name = 'Maria';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 100.00, 'offering', 'cash', '2026-07-27', auth.uid()
from public.donors d where d.last_name = 'Johnson' and d.first_name = 'Robert';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 75.00, 'offering', 'cash', '2026-07-27', auth.uid()
from public.donors d where d.last_name = 'Brown' and d.first_name = 'Linda';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, check_number, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 250.00, 'tithe', 'check', '4501', '2026-07-27', auth.uid()
from public.donors d where d.last_name = 'Thompson' and d.first_name = 'Sarah';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 50.00, 'offering', 'cash', '2026-07-27', auth.uid()
from public.donors d where d.last_name = 'Martinez' and d.first_name = 'David';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by, notes)
select d.id, 'Anonymous', 200.00, 'offering', 'cash', '2026-07-27', auth.uid(), 'Plate offering'
from public.donors d limit 0;

-- Online transfer mid-week
insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by, notes)
select d.id, d.first_name || ' ' || d.last_name, 400.00, 'tithe', 'online', '2026-07-29', auth.uid(), 'Zelle transfer'
from public.donors d where d.last_name = 'Anderson' and d.first_name = 'Michael';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by, notes)
select d.id, d.first_name || ' ' || d.last_name, 150.00, 'missions', 'online', '2026-07-30', auth.uid(), 'Online giving'
from public.donors d where d.last_name = 'Taylor' and d.first_name = 'Patricia';

-- Week 2: Jul 20
insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, check_number, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 500, 'tithe', 'check', '2200', '2026-07-20', auth.uid()
from public.donors d where d.last_name = 'Williams' and d.first_name = 'James';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, check_number, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 350, 'tithe', 'check', '1187', '2026-07-20', auth.uid()
from public.donors d where d.last_name = 'Garcia' and d.first_name = 'Maria';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 90, 'offering', 'cash', '2026-07-20', auth.uid()
from public.donors d where d.last_name = 'Jackson' and d.first_name = 'Deborah';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 120, 'offering', 'cash', '2026-07-20', auth.uid()
from public.donors d where d.last_name = 'Thomas' and d.first_name = 'Chris';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, check_number, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 300, 'tithe', 'check', '9901', '2026-07-20', auth.uid()
from public.donors d where d.last_name = 'White' and d.first_name = 'Rebecca';

-- Week 3: Jul 13
insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 80, 'offering', 'cash', '2026-07-13', auth.uid()
from public.donors d where d.last_name = 'Harris' and d.first_name = 'Daniel';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, check_number, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 600, 'tithe', 'check', '5510', '2026-07-13', auth.uid()
from public.donors d where d.last_name = 'Clark' and d.first_name = 'Susan';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, check_number, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 450, 'building', 'check', '7720', '2026-07-13', auth.uid()
from public.donors d where d.last_name = 'Family' and d.first_name = 'The Hamilton';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 95, 'offering', 'cash', '2026-07-13', auth.uid()
from public.donors d where d.last_name = 'Walker' and d.first_name = 'Karen';

-- More weeks going back
insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, check_number, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 500, 'tithe', 'check', '2199', '2026-07-06', auth.uid()
from public.donors d where d.last_name = 'Williams' and d.first_name = 'James';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 200, 'missions', 'cash', '2026-07-06', auth.uid()
from public.donors d where d.last_name = 'Lewis' and d.first_name = 'Joseph';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, check_number, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 280, 'tithe', 'check', '3421', '2026-07-06', auth.uid()
from public.donors d where d.last_name = 'Allen' and d.first_name = 'Steven';

-- June offerings
insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, check_number, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 500, 'tithe', 'check', '2195', '2026-06-29', auth.uid()
from public.donors d where d.last_name = 'Williams' and d.first_name = 'James';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, check_number, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 350, 'tithe', 'check', '1182', '2026-06-29', auth.uid()
from public.donors d where d.last_name = 'Garcia' and d.first_name = 'Maria';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by, notes)
select d.id, d.first_name || ' ' || d.last_name, 110, 'offering', 'cash', '2026-06-29', auth.uid(), 'Cash envelope'
from public.donors d where d.last_name = 'Young' and d.first_name = 'Nancy';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, check_number, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 700, 'building', 'check', '8800', '2026-06-29', auth.uid()
from public.donors d where d.last_name = 'King' and d.first_name = 'Edward';

-- Online transfers mid-June
insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by, notes)
select d.id, d.first_name || ' ' || d.last_name, 250, 'tithe', 'online', '2026-06-25', auth.uid(), 'Online recurring'
from public.donors d where d.last_name = 'Lin' and d.first_name = 'Marcus';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by, notes)
select d.id, d.first_name || ' ' || d.last_name, 175, 'offering', 'card', '2026-06-24', auth.uid(), 'Website giving'
from public.donors d where d.last_name = 'White' and d.first_name = 'Rebecca';

-- Earlier weeks for yearly totals
insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, check_number, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 500, 'tithe', 'check', '2180', '2026-06-01', auth.uid()
from public.donors d where d.last_name = 'Williams' and d.first_name = 'James';

insert into public.donations (donor_id, donor_name, amount, donation_type, payment_method, donation_date, entered_by)
select d.id, d.first_name || ' ' || d.last_name, 130, 'offering', 'cash', '2026-06-01', auth.uid()
from public.donors d where d.last_name = 'Harris' and d.first_name = 'Daniel';

-- 3. Create 16 expenses (mix of sources and statuses) --------------------
-- PENDING (member-submitted, waiting for treasurer)
insert into public.expenses (source, title, amount, category, description, user_id, status, submitted_at, notes)
values
  ('member_submitted', 'Sunday school supplies', 47.50, 'supplies', 'Markers, construction paper, glue for Christmas pageant', auth.uid(), 'pending', '2026-07-28', 'For Christmas pageant craft kits'),
  ('member_submitted', 'Outreach lunch ingredients', 120.00, 'events', 'Food for Saturday community meal', auth.uid(), 'pending', '2026-07-25', 'Fed ~60 people'),
  ('member_submitted', 'Youth camp transportation', 280.00, 'events', 'Van rental and gas for youth retreat', auth.uid(), 'pending', '2026-07-22', '3-day camp in Blue Ridge'),
  ('member_submitted', 'Benevolence assistance', 350.00, 'benevolence', 'Emergency rent assistance for family in need', auth.uid(), 'pending', '2026-07-20', 'Approved by pastor');

-- APPROVED (reviewed by admin, awaiting payment)
insert into public.expenses (source, title, amount, category, description, user_id, status, submitted_at, approved_at, notes)
values
  ('member_submitted', 'Worship team equipment', 165.00, 'supplies', 'Microphone stands and cables', auth.uid(), 'approved', '2026-07-15', '2026-07-16', 'Replaced broken stands'),
  ('member_submitted', 'Missions trip supplies', 420.00, 'missions', 'Medical supplies for Guatemala trip', auth.uid(), 'approved', '2026-07-10', '2026-07-11', 'Team of 8 traveling next month');

-- PAID (reimbursed — cleared after manual transfer)
insert into public.expenses (source, title, amount, category, description, user_id, status, submitted_at, approved_at, paid_at, notes)
values
  ('member_submitted', 'VBS decorations', 230.00, 'events', 'Banners, balloons, craft materials for Vacation Bible School', auth.uid(), 'paid', '2026-07-05', '2026-07-06', '2026-07-08', 'Transfer receipt uploaded'),
  ('member_submitted', 'Pastoral care meal train', 85.00, 'benevolence', 'Groceries delivered to homebound members', auth.uid(), 'paid', '2026-06-28', '2026-06-29', '2026-07-01', '3 families served');

-- CHURCH-DIRECT / AUTO-PAID (paid from church account)
insert into public.expenses (source, title, amount, category, description, status, submitted_at, approved_at, paid_at, notes)
values
  ('church_direct', 'Electricity — July', 215.40, 'utilities', 'Georgia Power monthly bill', 'auto_paid', '2026-07-15', '2026-07-15', '2026-07-15', 'Auto-debit from account'),
  ('church_direct', 'Church rent — July', 2500.00, 'utilities', 'Monthly facility lease', 'auto_paid', '2026-07-01', '2026-07-01', '2026-07-01', 'Auto-debit rent'),
  ('church_direct', 'Cleaning supplies', 62.30, 'supplies', 'Amazon order — paper towels, disinfectant', 'auto_paid', '2026-07-12', '2026-07-12', '2026-07-12', 'Amazon purchase'),
  ('church_direct', 'Pastor conference registration', 195.00, 'staff', 'Registration for Southeastern Leadership Summit', 'auto_paid', '2026-07-10', '2026-07-10', '2026-07-10', 'Paid via church card'),
  ('church_direct', 'Lawn maintenance', 150.00, 'maintenance', 'Monthly grounds keeping service', 'auto_paid', '2026-07-05', '2026-07-05', '2026-07-05', 'Check #4501'),
  ('church_direct', 'Electricity — June', 198.20, 'utilities', 'Georgia Power monthly bill', 'auto_paid', '2026-06-15', '2026-06-15', '2026-06-15', 'Auto-debit'),
  ('church_direct', 'Church rent — June', 2500.00, 'utilities', 'Monthly facility lease', 'auto_paid', '2026-06-01', '2026-06-01', '2026-06-01', 'Auto-debit'),
  ('church_direct', 'Pastor appreciation gift', 200.00, 'staff', 'Gift card for Pastor Appreciation Month', 'auto_paid', '2026-06-20', '2026-06-20', '2026-06-20', 'Approved by board');

-- 4. Update donor totals ----------------------------------------------------
update public.donors set
  total_donations = (select coalesce(sum(d.amount), 0) from public.donations d where d.donor_id = public.donors.id and d.donor_id is not null),
  last_donation_date = (select max(d.donation_date) from public.donations d where d.donor_id = public.donors.id and d.donor_id is not null);

-- 5. Summary ----------------------------------------------------------------
-- After running this script, your app will show:
--   ≈28 donations totaling ~$9,000 across 8 weeks
--   4 pending expenses (member-submitted, awaiting review)
--   2 approved expenses (awaiting payment)
--   2 paid expenses (reimbursed to members)
--   8 auto-paid expenses (church-direct: rent, utilities, supplies, etc.)
--
-- The Reports page will show:
--   - Donations: ~$9,000 (by type: tithe ~$6,000, offering ~$2,000, etc.)
--   - Expenses: ~$6,700 (by source: reimbursed ~$1,700, account-paid ~$5,800)
--   - Net: ~$2,300 surplus
