# Fiber Resolution Decisions

Date: 2026-04-15

## Current product decision

Arcova is optimizing for coverage first, trust second.

That means:
- We should maximize the number of people we can resolve and enrich through Fiber.
- We will assume Fiber data is good enough for Phase 1 unless it clearly fails.
- We will store the full raw Fiber payloads so we can add verification and trust checks later without re-enriching contacts.

## What problem we are solving right now

The immediate question is:

What data do we need to send to Fiber in order to get back a usable enriched contact payload?

This is a two-phase process:

1. Resolve the person
2. Enrich the resolved person

## Minimum acceptable outcome for a usable lead

A person is only relevant if Arcova can identify them at the right company and return contactable profile data.

Every usable lead must have:
- person identity
- current company
- current role at that company
- contact details

The most important contact fields are:
- email
- LinkedIn link
- LinkedIn profile

Secondary contact field:
- phone number

If we do not get the company, the person is not relevant.
If we do not get contact details, the person is not relevant.

## Resolution priorities

Fiber resolution should try input combinations in order and stop when a usable person is found.

Important combinations to test:
- LinkedIn URL
- email
- full name + company domain
- full name + company name
- first name + last name + company name

## Company requirement

The company is required for relevance.

We can start with company-based lookup and company roster search if needed, but the end state must still give us:
- the person
- the current company
- the current role
- contact details

## Trust and verification

Trust is important, but it is a second-phase concern after coverage.

Phase 1:
- get the person resolved
- get the enriched payload
- store the raw Fiber data

Phase 2:
- decide whether and how to double-check records for trust and accuracy

## Raw Fiber storage

We are preserving the full Fiber payloads on `contacts` so display and verification decisions can happen later without re-enrichment.
