import type { LukeWorkflow } from "../../shared/types";

export const BUILT_IN_WORKFLOWS_PART_FOUR: LukeWorkflow[] = [
  {
    id: "builtin-shareholder-agreement",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "Shareholder Agreement Review",
    type: "tabular",
    practice: "Corporate",
    prompt_md: null,
    columns_config: [
      {
        index: 0,
        name: "Parties",
        format: "bulleted_list",
        prompt:
          "Identify all parties to this shareholder agreement. For each, state their full legal name, jurisdiction of incorporation or establishment (if stated), and their role (e.g. company, majority shareholder, minority shareholder, investor, founder, management shareholder).",
      },
      {
        index: 1,
        name: "Date",
        format: "date",
        prompt: "What is the date of this shareholder agreement?",
      },
      {
        index: 2,
        name: "Share Capital & Classes",
        format: "bulleted_list",
        prompt:
          "What classes of shares are in issue or contemplated by this agreement? For each class, describe the key rights attaching to it including voting rights, dividend rights, liquidation preference (if any), and any conversion or redemption features.",
      },
      {
        index: 3,
        name: "Shareholdings",
        format: "bulleted_list",
        prompt:
          "What are the shareholdings of each party as set out or contemplated in this agreement? For each shareholder, state the number of shares held, the class, and the percentage of total share capital (on a fully diluted basis if stated).",
      },
      {
        index: 4,
        name: "Board Composition",
        format: "text",
        prompt:
          "How is the board of directors constituted under this agreement? State the total number of directors, each shareholder's or class of shareholders' right to appoint or nominate directors (and the threshold shareholding required to maintain that right), and any provisions for a chairman or casting vote.",
      },
      {
        index: 5,
        name: "Reserved Matters",
        format: "bulleted_list",
        prompt:
          "What are the reserved matters or veto rights set out in this agreement? List each matter that requires shareholder or director approval beyond an ordinary majority (e.g. special majority, unanimity, or the consent of a specific shareholder). Identify the applicable threshold or whose consent is required for each.",
      },
      {
        index: 6,
        name: "Pre-emption on New Shares",
        format: "text",
        prompt:
          "What pre-emption rights apply on the issuance of new shares? Describe who holds pre-emption rights, the procedure for offering new shares to existing shareholders, the timeline for acceptance, and any carve-outs or exceptions (e.g. shares issued under an employee option scheme, permitted issuances).",
      },
      {
        index: 7,
        name: "Transfer Restrictions",
        format: "text",
        prompt:
          "What restrictions apply to the transfer of shares? Identify any lock-up periods (and their duration), which transfers are prohibited outright, and which transfers are permitted without consent (e.g. transfers to affiliates or family trusts). Note any board or shareholder approval requirements for transfers.",
      },
      {
        index: 8,
        name: "Right of First Refusal / Pre-emption on Transfer",
        format: "text",
        prompt:
          "Is there a right of first refusal or pre-emption right on a proposed transfer of shares? If so, describe who holds the right, the procedure for triggering and exercising it (including notice periods and pricing mechanics), and any exceptions.",
      },
      {
        index: 9,
        name: "Drag-Along Rights",
        format: "text",
        prompt:
          "Are there drag-along rights? If so, identify who holds the drag right (e.g. majority shareholders above a specified threshold), the threshold required to trigger a drag, the obligations imposed on dragged shareholders, any conditions on the drag (e.g. minimum price, independent valuation), and any protections for minority shareholders.",
      },
      {
        index: 10,
        name: "Tag-Along Rights",
        format: "text",
        prompt:
          "Are there tag-along rights? If so, identify who holds the tag right, the threshold transfer that triggers the tag, the procedure for exercising the tag (including notice periods), the price and terms on which the tagging shareholder may sell, and any exceptions.",
      },
      {
        index: 11,
        name: "Anti-Dilution Protections",
        format: "text",
        prompt:
          "Are there any anti-dilution protections for any class of shareholders? If so, describe the type of protection (e.g. full ratchet, weighted average, broad-based or narrow-based), the trigger events, how the adjusted price or entitlement is calculated, and any exceptions (e.g. permitted issuances excluded from the calculation).",
      },
      {
        index: 12,
        name: "Dividend Policy",
        format: "text",
        prompt:
          "What dividend provisions are set out in this agreement? Describe any obligation or policy to pay dividends (e.g. a minimum percentage of distributable profits), any preferential dividend rights attaching to a particular class of shares, and any restrictions on dividend payments (e.g. subject to available profits, board or shareholder approval, lender consent).",
      },
      {
        index: 13,
        name: "Exit & Liquidity Provisions",
        format: "text",
        prompt:
          "What exit or liquidity provisions are included? Describe any agreed exit mechanisms (e.g. trade sale, IPO, drag-along sale), any timelines or milestones by which an exit is targeted, any shareholder rights to initiate or compel an exit process after a specified period, and any preference on exit proceeds attaching to a particular class of shares.",
      },
      {
        index: 14,
        name: "Deadlock",
        format: "text",
        prompt:
          "How is deadlock addressed? Describe any deadlock resolution mechanisms (e.g. escalation to senior management, mediation, Russian roulette / shoot-out provisions, put/call options). For each mechanism, state the trigger conditions, the procedure, and the consequences if deadlock is not resolved.",
      },
      {
        index: 15,
        name: "Non-Compete & Non-Solicitation",
        format: "text",
        prompt:
          "Are any shareholders subject to non-compete or non-solicitation obligations? If so, identify which shareholders are bound, the scope of the restriction (activities and geography), and the duration (during the term of the agreement and/or for a period after a shareholder ceases to hold shares). Note any carve-outs.",
      },
      {
        index: 16,
        name: "Confidentiality",
        format: "text",
        prompt:
          "What confidentiality obligations are imposed on the shareholders? State the scope of confidential information covered, the permitted disclosures (e.g. to professional advisers, affiliates, lenders), and the duration of the obligation. Note whether the obligation survives termination of the agreement.",
      },
      {
        index: 17,
        name: "Warranties",
        format: "text",
        prompt:
          "What warranties are given by the shareholders under this agreement? Identify who gives warranties, the subject matter (e.g. title to shares, capacity, no encumbrances, no conflicts), any limitations on warranty claims (e.g. time limits, caps, knowledge qualifications), and any indemnities given alongside the warranties.",
      },
      {
        index: 18,
        name: "Governing Law",
        format: "text",
        prompt:
          "What governing law applies to this agreement? State the jurisdiction and any specific legal system referenced.",
      },
      {
        index: 19,
        name: "Dispute Resolution",
        format: "text",
        prompt:
          "How are disputes resolved under this agreement? Identify whether disputes go to litigation or arbitration, the chosen forum or seat, any mandatory escalation steps, and whether jurisdiction is exclusive.",
      },
    ],
  },

  // ─── Employment Agreement ─────────────────────────────────────────────────────
  {
    id: "builtin-employment-agreement",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "Employment Agreement Review",
    type: "tabular",
    practice: "Employment",
    prompt_md: null,
    columns_config: [
      {
        index: 0,
        name: "Employer",
        format: "text",
        prompt:
          "Who is the employer under this agreement? State the full legal name and jurisdiction of incorporation or establishment.",
      },
      {
        index: 1,
        name: "Employee",
        format: "text",
        prompt:
          "Who is the employee under this agreement? State their full name and, if provided, their address or location.",
      },
      {
        index: 2,
        name: "Date",
        format: "date",
        prompt:
          "What is the date of this employment agreement? If a commencement date or start date differs from the signing date, state both.",
      },
      {
        index: 3,
        name: "Title",
        format: "text",
        prompt:
          "What is the employee's job title or position as stated in this agreement? If a reporting line is specified, include it.",
      },
      {
        index: 4,
        name: "Compensation",
        format: "text",
        prompt:
          "What is the employee's compensation under this agreement? State the base salary or wage, the currency, and the payment frequency (e.g. monthly, bi-weekly). Include any guaranteed bonus, commission, or other fixed remuneration elements.",
      },
      {
        index: 5,
        name: "Full Time / Part Time",
        format: "tag",
        tags: ["Full Time", "Part Time"],
        prompt:
          "Is this a full-time or part-time position? If part-time, state the number of days or hours per week where specified.",
      },
      {
        index: 6,
        name: "Independent Contractor?",
        format: "yes_no",
        prompt:
          "Does the agreement characterise the worker as an independent contractor rather than an employee? Answer Yes if the agreement uses contractor, consultant, or self-employed language. Note any provisions that address the nature of the relationship.",
      },
      {
        index: 7,
        name: "Benefits",
        format: "bulleted_list",
        prompt:
          "What benefits are the employee entitled to under this agreement? List each benefit (e.g. health insurance, pension/retirement contributions, life assurance, car allowance, share options, expense reimbursement). Note any eligibility conditions or limits.",
      },
      {
        index: 8,
        name: "Notice Period (Employer to Employee)",
        format: "text",
        prompt:
          "What notice must the employer give to terminate the employee's employment (other than for cause)? State the notice period and any provisions for payment in lieu of notice.",
      },
      {
        index: 9,
        name: "Notice Period (Employee to Employer)",
        format: "text",
        prompt:
          "What notice must the employee give to resign? State the notice period and any provisions for payment in lieu of notice or garden leave.",
      },
      {
        index: 10,
        name: "Overtime",
        format: "text",
        prompt:
          "What provisions apply to overtime? Is the employee eligible for overtime pay, and if so at what rate? Or does the agreement state that the salary is inclusive of any overtime? Note any opt-out of statutory working time limits.",
      },
      {
        index: 11,
        name: "Working Hours",
        format: "text",
        prompt:
          "What working hours are specified in this agreement? State the normal hours of work, any flexibility provisions, and whether the employee is expected to work additional hours as required.",
      },
      {
        index: 12,
        name: "Variation",
        format: "text",
        prompt:
          "What provisions govern variation of the terms of this agreement? Can the employer unilaterally vary terms, or is the employee's consent required? Note any specific terms that are stated to be variable without consent.",
      },
      {
        index: 13,
        name: "Intellectual Property Assignment",
        format: "text",
        prompt:
          "What intellectual property assignment provisions are included? Does the employee assign to the employer all IP created in the course of employment? Are there any carve-outs for pre-existing IP or inventions created outside working hours? Note any moral rights waiver.",
      },
      {
        index: 14,
        name: "Grounds for Termination",
        format: "bulleted_list",
        prompt:
          "What grounds for summary dismissal or termination for cause are set out in the agreement? List each ground (e.g. gross misconduct, breach of confidentiality, insolvency, criminal conviction). Note whether summary dismissal is without notice or payment in lieu.",
      },
      {
        index: 15,
        name: "Annual Leave Entitlement",
        format: "text",
        prompt:
          "What is the employee's annual leave entitlement? State the number of days (or weeks) per year, whether this is inclusive of or in addition to public holidays, and any provisions for accrual, carry-over, or payment of untaken leave on termination.",
      },
    ],
  },

  // ─── Accomplishments by Company ─────────────────────────────────────────────
  // Entity-row workflow: one extracted accomplishment per row, with the
  // company and date attached as columns. The anchor extractor identifies
  // the accomplishment anchors; columns then ask about each one individually.
  {
    id: "builtin-accomplishments-by-company",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "Accomplishments by Company",
    type: "tabular",
    practice: "Talent",
    prompt_md: null,
    row_mode: "entity",
    anchor_extractor: {
      prompt:
        "Identify every concrete accomplishment, achievement, or notable contribution attributable to the subject of this document. " +
        "An accomplishment is an OUTCOME (shipped a product, led a team, won an award, closed a deal, published a paper, grew a metric, was promoted), NOT a mere responsibility or job duty.\n\n" +
        "For each accomplishment, return one anchor with:\n" +
        '- "label": a short sentence describing the accomplishment (max ~120 chars)\n' +
        '- "summary": the verbatim sentence(s) from the document that ground the accomplishment\n' +
        '- "metadata": { "company": <string|null>, "role": <string|null>, "start_date": <"Mon YYYY"|null>, "end_date": <"Mon YYYY"|"Present"|null> }\n\n' +
        "Match each accomplishment to the company where it was achieved using the document's employment dates. " +
        'If the accomplishment is not tied to any company (personal project, education, independent work), set "company" to "Independent". ' +
        "If a date is missing or ambiguous, use null. Do not invent companies, roles, dates, or accomplishments not supported by the document.",
    },
    columns_config: [
      {
        index: 0,
        name: "Company",
        format: "text",
        prompt:
          'Which company is associated with this accomplishment? Return only the company name, e.g. "Acme Corp". If the accomplishment is personal or unaffiliated, return "Independent". If the document does not state a company, return "Not addressed".',
      },
      {
        index: 1,
        name: "Role",
        format: "text",
        prompt:
          'What role did the subject hold when this accomplishment was achieved? Return the most specific title supported by the document. If unstated, return "Not addressed".',
      },
      {
        index: 2,
        name: "Date",
        format: "date",
        prompt:
          'When did this accomplishment occur? Return a single date or short range in "Mon YYYY" form (e.g. "Mar 2022" or "Mar 2022 – Jun 2022"). If only an employment range is known, return that range. If unknown, return "Unknown".',
      },
      {
        index: 3,
        name: "Impact",
        format: "text",
        prompt:
          'Quantify the impact of this accomplishment using the document\'s own language: growth %, dollars, headcount, customers, time saved, etc. If no quantitative result is stated, return one sentence describing the qualitative impact. If the document offers neither, return "Not addressed".',
      },
      {
        index: 4,
        name: "Evidence",
        format: "text",
        prompt:
          "Quote the verbatim sentence(s) from the document that establish this accomplishment. Do not paraphrase. If no single sentence captures it, quote the smallest contiguous span that does.",
      },
    ],
  },
];
