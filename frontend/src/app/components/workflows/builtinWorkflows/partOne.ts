import type { LukeWorkflow } from "../../shared/types";

export const BUILT_IN_WORKFLOWS_PART_ONE: LukeWorkflow[] = [
  {
    id: "builtin-cp-checklist",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "Generate CP Checklist",
    type: "assistant",
    practice: "General Transactions",
    prompt_md:
      "## Generate Conditions Precedent Checklist\n\n" +
      "Review the uploaded credit agreement or financing document and generate a comprehensive " +
      "Conditions Precedent (CP) checklist.\n\n" +
      "You MUST use the generate_docx tool to produce the checklist as a downloadable Word document. " +
      "You MUST pass landscape: true to the generate_docx tool — the document must be in landscape orientation. " +
      "Do not display the checklist inline — generate the .docx file and provide the download link.\n\n" +
      "Structure the document as follows:\n" +
      "- For each category of conditions (e.g. Corporate, Financial, Legal, Security), add a section with a heading\n" +
      "- Under each category heading, include a table with exactly these four columns in this order:\n" +
      "  1. Index — sequential number within the category (1, 2, 3…)\n" +
      "  2. Clause Number — the clause or schedule reference from the agreement\n" +
      "  3. Clause — a concise description of the condition precedent\n" +
      "  4. Status — leave blank (empty string) for the user to fill in\n\n" +
      "Use the table field in the section object (not content) for each category's rows.",
    columns_config: null,
  },
  {
    id: "builtin-coc-dd",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "Change of Control Review",
    type: "tabular",
    practice: "Corporate",
    prompt_md:
      "## Change of Control Due Diligence Review\n\n" +
      "This workflow performs a change of control due diligence review across the selected documents.",
    columns_config: [
      {
        index: 0,
        name: "Parties",
        format: "bulleted_list",
        prompt:
          "Identify all parties to this agreement. For each party state their full legal name and their role (e.g. counterparty, licensor, lender, supplier).",
      },
      {
        index: 1,
        name: "Date",
        format: "date",
        prompt:
          "What is the date of this agreement? If a commencement date differs from the signing date, state both.",
      },
      {
        index: 2,
        name: "Term",
        format: "text",
        prompt:
          "What is the term or duration of this agreement? State the start and end dates or the length of the term.",
      },
      {
        index: 3,
        name: "Change of Control Clause",
        prompt:
          "Identify and summarize the change of control clause(s) in this document. Quote the exact triggering language and specify what constitutes a 'change of control'.",
      },
      {
        index: 4,
        name: "Consent Required",
        prompt:
          "Does a change of control require prior consent from any party? Identify who must consent, the notice period, and any conditions.",
      },
      {
        index: 5,
        name: "Termination Rights",
        prompt:
          "What termination rights arise upon a change of control? Who can terminate, and what are the notice requirements?",
      },
      {
        index: 6,
        name: "Put/Call Options",
        prompt:
          "Are there any put or call options triggered by a change of control? Summarize the terms, pricing, and exercise period.",
      },
      {
        index: 7,
        name: "Financial Implications",
        prompt:
          "What are the financial implications of a change of control? Include any fees, payments, accelerated obligations, or pricing adjustments.",
      },
    ],
  },
  {
    id: "builtin-credit-summary",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "Credit Agreement Summary",
    type: "assistant",
    practice: "Finance",
    prompt_md:
      "## Credit Agreement Summary\n\n" +
      "Review the uploaded credit agreement and produce a comprehensive legal summary covering the following topics. " +
      "For each section, identify the key provisions, quote the relevant clause or schedule references, and flag any unusual, onerous, or non-market terms.\n\n" +
      "1. **Lenders** — All lenders or members of the lender syndicate, including their full legal name and role (e.g. mandated lead arranger, original lender, agent bank)\n" +
      "2. **Borrowers** — All borrowers, including their full legal name and jurisdiction of incorporation\n" +
      "3. **Guarantors** — All guarantors, including their full legal name and the scope of their guarantee obligation\n" +
      "4. **Other Parties** — Any other material parties (e.g. facility agent, security agent, hedge counterparties, issuing bank) and their roles\n" +
      "5. **Date of Agreement** — Date of the credit agreement\n" +
      "6. **Facilities** — Each facility available (e.g. Revolving Credit Facility, Term Loan A, Term Loan B, Term Loan C), the facility type, tranche name, and any key structural features\n" +
      "7. **Amount** — Total committed amount across all facilities, the currency, and breakdown by tranche if applicable\n" +
      "8. **Purpose** — Stated purpose for which borrowings may be used and any restrictions on use of proceeds\n" +
      "9. **Interest** — Applicable reference rate (e.g. SOFR, EURIBOR, base rate), the margin, any margin ratchet mechanism, and how interest periods are structured\n" +
      "10. **Commitment Fee** — Commitment or utilisation fees, the applicable rate, how they are calculated, and the basis (e.g. undrawn commitment, average utilisation)\n" +
      "11. **Repayment Schedule** — Repayment profile for each facility, whether by scheduled instalments or bullet repayment, and the repayment dates and amounts\n" +
      "12. **Maturity** — Final maturity date for each facility\n" +
      "13. **Security** — Each class of security granted or required (e.g. share pledges, fixed and floating charges, real estate mortgages, account pledges) and the assets or entities over which security is taken\n" +
      "14. **Guarantees** — Guarantee obligations, the guarantors, the scope of the guarantee, and any limitations (e.g. up-stream guarantee limitations, guarantor coverage test)\n" +
      "15. **Financial Covenants** — Each financial covenant, the metric (e.g. leverage ratio, interest cover, cashflow cover), the applicable test, testing frequency, and any equity cure rights\n" +
      "16. **Events of Default** — Each event of default, noting any grace periods, materiality thresholds, or cross-default provisions\n" +
      "17. **Assignment** — Restrictions or permissions on assignment or transfer (e.g. white/blacklists, borrower consent for lender transfers; restrictions on borrower assignment)\n" +
      "18. **Change of Control** — What constitutes a change of control, what obligations it triggers (e.g. mandatory prepayment, cancellation, lender consent), and any cure period\n" +
      "19. **Prepayment Fee** — Any prepayment fees, make-whole premiums, or soft-call protections, the applicable fee, the period during which it applies, and any exceptions (e.g. prepayment from insurance proceeds or asset disposals)\n" +
      "20. **Governing Law** — Governing law of the agreement\n" +
      "21. **Dispute Resolution** — Whether disputes go to litigation or arbitration, the chosen forum or seat, and any submission to jurisdiction provisions\n\n" +
      "Deliver the summary inline in your chat response — do NOT call generate_docx. Only produce a downloadable Word document if the user explicitly asks for one.",
    columns_config: null,
  },

  // ─── Commercial Agreement ───────────────────────────────────────────────────
  {
    id: "builtin-commercial-agreement",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "Commercial Agreement Review",
    type: "tabular",
    practice: "General Transactions",
    prompt_md: null,
    columns_config: [
      {
        index: 0,
        name: "Parties",
        format: "bulleted_list",
        prompt:
          "Identify all parties to this agreement. For each party state their full legal name, jurisdiction of incorporation (if stated), and their role in the agreement (e.g. supplier, customer, licensor).",
      },
      {
        index: 1,
        name: "Scope of Work",
        format: "text",
        prompt:
          "Summarise the scope of work or services to be provided under this agreement. What are the key deliverables, obligations, or services? Identify any limitations or exclusions to the scope.",
      },
      {
        index: 2,
        name: "Amends Earlier Agreement",
        format: "yes_no",
        prompt:
          "Does this agreement amend, restate, supplement, or replace an earlier agreement? If yes, identify the earlier agreement by name and date.",
      },
      {
        index: 3,
        name: "Effective Date",
        format: "date",
        prompt:
          "What is the effective date or commencement date of this agreement? If no explicit date is stated, note when it is deemed to take effect.",
      },
      {
        index: 4,
        name: "Term",
        format: "text",
        prompt:
          "What is the duration or term of this agreement? State the initial term length and any conditions that affect the duration.",
      },
      {
        index: 5,
        name: "Renewal",
        format: "text",
        prompt:
          "What renewal provisions apply? Specify whether renewal is automatic or requires notice, the renewal period, and any conditions or notice periods required to prevent automatic renewal.",
      },
      {
        index: 6,
        name: "Pricing",
        format: "text",
        prompt:
          "What is the pricing structure under this agreement? Identify all fees, rates, charges, and payment terms including currency, payment schedule, and invoicing requirements.",
      },
      {
        index: 7,
        name: "Price Adjustments",
        format: "text",
        prompt:
          "Are there any price adjustment mechanisms in this agreement? Identify any indexation, CPI/RPI linkage, benchmarking, volume-based adjustments, or other mechanisms that allow prices to change over the term.",
      },
      {
        index: 8,
        name: "Penalties for Late Payment",
        format: "text",
        prompt:
          "What penalties or consequences apply for late payment? Include any interest rates on overdue amounts, suspension rights, or other remedies available to the payee.",
      },
      {
        index: 9,
        name: "Estimated Contract Value",
        format: "monetary_amount",
        prompt:
          "What is the total estimated or stated contract value? If no single figure is given, calculate or estimate based on stated rates and term. State the currency and any assumptions made.",
      },
      {
        index: 10,
        name: "Limitation of Liability",
        format: "text",
        prompt:
          "What limitations of liability apply? Identify any caps on liability (including how they are calculated), exclusions of consequential or indirect loss, and any carve-outs from the cap (e.g. fraud, death, IP infringement).",
      },
      {
        index: 11,
        name: "IP Ownership and Licensing",
        format: "text",
        prompt:
          "How is intellectual property ownership and licensing addressed? Identify who owns pre-existing IP, who owns newly created IP, and what licences are granted to each party. Note any restrictions on use.",
      },
      {
        index: 12,
        name: "Change of Control",
        format: "text",
        prompt:
          "Is there a change of control provision? If so, describe what constitutes a change of control, whether consent is required, and what rights (e.g. termination, assignment) are triggered.",
      },
      {
        index: 13,
        name: "Force Majeure",
        format: "text",
        prompt:
          "Summarise the force majeure clause. What events qualify, what obligations are suspended, how long must the event persist before termination is permitted, and what notice is required?",
      },
      {
        index: 14,
        name: "Termination Rights",
        format: "text",
        prompt:
          "What are the termination rights of each party? Identify termination for convenience (including notice period), termination for cause (including cure periods), and the consequences of termination (e.g. payment obligations, survival of terms).",
      },
      {
        index: 15,
        name: "Liquidated Damages",
        format: "text",
        prompt:
          "Are there any liquidated damages provisions? If so, identify what triggers them, the applicable rate or formula, any cap on aggregate liquidated damages, and whether they are the exclusive remedy.",
      },
      {
        index: 16,
        name: "Governing Law",
        format: "text",
        prompt:
          "What governing law applies to this agreement? State the jurisdiction and any specific legal system referenced.",
      },
      {
        index: 17,
        name: "Dispute Resolution",
        format: "text",
        prompt:
          "How are disputes resolved under this agreement? Identify whether disputes go to litigation or arbitration, the chosen forum or seat, any escalation or mediation steps required before formal proceedings, and the language of proceedings.",
      },
    ],
  },

  // ─── Credit Agreement ────────────────────────────────────────────────────────
  {
    id: "builtin-credit-agreement",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "Credit Agreement Review",
    type: "tabular",
    practice: "Finance",
    prompt_md: null,
    columns_config: [
      {
        index: 0,
        name: "Lenders",
        format: "bulleted_list",
        prompt:
          "Identify all lenders (or the lender syndicate) named in this agreement. For each, state their full legal name and role (e.g. mandated lead arranger, original lender, agent bank).",
      },
      {
        index: 1,
        name: "Borrowers",
        format: "bulleted_list",
        prompt:
          "Identify all borrowers named in this agreement, including their full legal name and jurisdiction of incorporation.",
      },
      {
        index: 2,
        name: "Guarantors",
        format: "bulleted_list",
        prompt:
          "Identify all guarantors named in this agreement, including their full legal name and the scope of their guarantee obligation.",
      },
      {
        index: 3,
        name: "Other Parties",
        format: "bulleted_list",
        prompt:
          "Identify any other material parties to this agreement (e.g. facility agent, security agent, hedge counterparties, issuing bank). State their name and role.",
      },
      {
        index: 4,
        name: "Date of Agreement",
        format: "date",
        prompt: "What is the date of this credit agreement?",
      },
      {
        index: 5,
        name: "Facility",
        format: "bulleted_list",
        prompt:
          "List each facility available under this agreement (e.g. Revolving Credit Facility, Term Loan A, Term Loan B, Term Loan C). For each, state the facility type, tranche name, and any key structural features.",
      },
      {
        index: 6,
        name: "Amount",
        format: "monetary_amount",
        prompt:
          "What is the total committed amount available under this agreement across all facilities? State the amount, currency, and breakdown by tranche if applicable.",
      },
      {
        index: 7,
        name: "Purpose",
        format: "text",
        prompt:
          "What is the stated purpose for which borrowings under this agreement may be used? Identify any restrictions on use of proceeds.",
      },
      {
        index: 8,
        name: "Interest",
        format: "text",
        prompt:
          "What interest rate applies to borrowings under this agreement? Identify the applicable rate (e.g. SOFR, EURIBOR, base rate), the margin, any margin ratchet mechanism, and how interest periods are structured.",
      },
      {
        index: 9,
        name: "Commitment Fee",
        format: "text",
        prompt:
          "Is there a commitment fee or utilisation fee? If so, state the applicable rate, how it is calculated, and on what basis (e.g. undrawn commitment, average utilisation).",
      },
      {
        index: 10,
        name: "Repayment Schedule",
        format: "text",
        prompt:
          "Summarise the repayment schedule for each facility. Identify whether repayment is by scheduled instalments or bullet repayment, and state the repayment dates and amounts where specified.",
      },
      {
        index: 11,
        name: "Maturity",
        format: "date",
        prompt:
          "What is the final maturity date of the facilities under this agreement? If different facilities have different maturities, state each.",
      },
      {
        index: 12,
        name: "Security",
        format: "bulleted_list",
        prompt:
          "What security is granted or required to be granted under this agreement? List each class of security (e.g. share pledges, fixed and floating charges, real estate mortgages, account pledges) and the assets or entities over which security is taken.",
      },
      {
        index: 13,
        name: "Guarantees",
        format: "bulleted_list",
        prompt:
          "What guarantee obligations are given under or in connection with this agreement? Identify the guarantors, the scope of the guarantee, and any limitations (e.g. up-stream guarantee limitations, guarantor coverage test).",
      },
      {
        index: 14,
        name: "Financial Covenants",
        format: "bulleted_list",
        prompt:
          "What financial covenants are included in this agreement? For each covenant identify the metric (e.g. leverage ratio, interest cover, cashflow cover), the applicable test, the testing frequency, and any equity cure rights.",
      },
      {
        index: 15,
        name: "Events of Default",
        format: "bulleted_list",
        prompt:
          "List the events of default under this agreement. For each, note any grace periods, materiality thresholds, or cross-default provisions.",
      },
      {
        index: 16,
        name: "Assignment",
        format: "text",
        prompt:
          "What restrictions or permissions apply to assignment or transfer of rights under this agreement? Identify restrictions on lender transfers (e.g. white/blacklists, borrower consent) and on borrower assignment.",
      },
      {
        index: 17,
        name: "Change of Control",
        format: "text",
        prompt:
          "Is there a change of control provision? If so, what constitutes a change of control, what obligations does it trigger (e.g. mandatory prepayment, cancellation, lender consent), and is there any cure period?",
      },
      {
        index: 18,
        name: "Prepayment Fee",
        format: "text",
        prompt:
          "Are there any prepayment fees, make-whole premiums, or soft-call protections? If so, state the applicable fee, the period during which it applies, and any exceptions (e.g. prepayment from insurance proceeds or asset disposal).",
      },
      {
        index: 19,
        name: "Governing Law",
        format: "text",
        prompt:
          "What governing law applies to this agreement? State the jurisdiction and any specific legal system referenced.",
      },
      {
        index: 20,
        name: "Dispute Resolution",
        format: "text",
        prompt:
          "How are disputes resolved under this agreement? Identify whether disputes go to litigation or arbitration, the chosen forum or seat, and any submission to jurisdiction provisions.",
      },
    ],
  },

  // ─── E-Discovery ─────────────────────────────────────────────────────────────
];
