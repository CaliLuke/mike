import type { LukeWorkflow } from "../../shared/types";

export const BUILT_IN_WORKFLOWS_PART_TWO: LukeWorkflow[] = [
  {
    id: "builtin-ediscovery",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "E-Discovery Review",
    type: "tabular",
    practice: "Litigation",
    prompt_md: null,
    columns_config: [
      {
        index: 0,
        name: "Date",
        format: "date",
        prompt:
          "What is the date of this document? For emails or correspondence, use the date sent. For other documents, use the date of creation, signature, or the most prominent date shown.",
      },
      {
        index: 1,
        name: "Type of Document",
        format: "text",
        prompt:
          "What type of document is this? (e.g. email, memorandum, letter, contract, report, meeting minutes, text message, invoice, presentation). Be specific.",
      },
      {
        index: 2,
        name: "Sender",
        format: "text",
        prompt:
          "Who is the sender or author of this document? State their full name, title, and organisation where identifiable.",
      },
      {
        index: 3,
        name: "Recipient(s)",
        format: "bulleted_list",
        prompt:
          "Who are the recipients of this document? List all To, CC, and BCC recipients where identifiable. State their full name, title, and organisation for each. Note whether they appear in To, CC, or BCC fields.",
      },
      {
        index: 4,
        name: "Summary",
        format: "text",
        prompt:
          "Provide a concise factual summary of the content of this document in 2–4 sentences. Focus on the key subject matter, any decisions made, actions requested, or information conveyed. Do not include legal conclusions.",
      },
      {
        index: 5,
        name: "Persons Mentioned",
        format: "bulleted_list",
        prompt:
          "List all individuals mentioned in this document (other than the sender and recipients already identified). For each person, state their name and, if discernible, their role or organisation.",
      },
      {
        index: 6,
        name: "Privileged?",
        format: "yes_no",
        prompt:
          "Does this document appear to be legally privileged? Answer Yes if it appears to be a communication between a lawyer and client made for the dominant purpose of obtaining or giving legal advice, or created for the dominant purpose of litigation. Answer No otherwise. If uncertain, note the basis for uncertainty.",
      },
    ],
  },

  // ─── Supply Agreement ────────────────────────────────────────────────────────
  {
    id: "builtin-supply-agreement",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "Supply Agreement Review",
    type: "tabular",
    practice: "General Transactions",
    prompt_md: null,
    columns_config: [
      {
        index: 0,
        name: "Parties",
        format: "bulleted_list",
        prompt:
          "Identify all parties to this supply agreement. For each, state their full legal name, jurisdiction of incorporation (if stated), and their role (e.g. supplier, buyer, distributor).",
      },
      {
        index: 1,
        name: "Effective Date",
        format: "date",
        prompt:
          "What is the effective date or commencement date of this agreement? If no explicit date is stated, note the date it is deemed to take effect.",
      },
      {
        index: 2,
        name: "Products",
        format: "bulleted_list",
        prompt:
          "What products are to be supplied under this agreement? List each product or product category, including any relevant specifications, part numbers, or standards referenced.",
      },
      {
        index: 3,
        name: "Term",
        format: "text",
        prompt:
          "What is the initial term or duration of this agreement? State the start date (or reference to when it commences) and the end date or duration.",
      },
      {
        index: 4,
        name: "Renewal",
        format: "text",
        prompt:
          "What renewal provisions apply? Is renewal automatic or by agreement? State the renewal period, notice requirements to prevent renewal, and any conditions on renewal.",
      },
      {
        index: 5,
        name: "Delivery",
        format: "text",
        prompt:
          "What delivery obligations and terms apply? Identify the delivery terms (e.g. Incoterms), delivery lead times, delivery locations, risk of loss, and any consequences for late or failed delivery.",
      },
      {
        index: 6,
        name: "Quality",
        format: "text",
        prompt:
          "What quality standards or specifications apply to the products? Identify any applicable standards (e.g. ISO, regulatory requirements), inspection rights, acceptance procedures, and consequences of non-conformance.",
      },
      {
        index: 7,
        name: "Warranties",
        format: "text",
        prompt:
          "What warranties does the supplier give in relation to the products? State the warranty period, the scope of the warranty (e.g. free from defects, conformance to specifications), the remedy for breach (e.g. repair, replacement, refund), and any exclusions.",
      },
      {
        index: 8,
        name: "Liquidated Damages",
        format: "text",
        prompt:
          "Are there any liquidated damages provisions? If so, identify what triggers them (e.g. late delivery, failure to meet quality standards), the applicable rate or formula, any aggregate cap, and whether they are stated to be the exclusive remedy.",
      },
      {
        index: 9,
        name: "Limitation of Liability",
        format: "text",
        prompt:
          "What limitations of liability apply? Identify any caps on liability (and how they are calculated, e.g. contract value, fees paid), exclusions of consequential or indirect loss, and any carve-outs from the limitation (e.g. fraud, wilful misconduct, death or personal injury).",
      },
      {
        index: 10,
        name: "Force Majeure",
        format: "text",
        prompt:
          "Summarise the force majeure clause. What events qualify, what obligations are suspended, what notice must be given, how long must the event persist before either party may terminate, and what are the consequences of termination for force majeure?",
      },
      {
        index: 11,
        name: "Termination Rights",
        format: "text",
        prompt:
          "What are the termination rights of each party? Distinguish between termination for convenience (including notice period) and termination for cause (including cure periods and triggers). Note what happens on termination, including any outstanding purchase orders or payment obligations.",
      },
      {
        index: 12,
        name: "Governing Law",
        format: "text",
        prompt:
          "What governing law applies to this agreement? State the jurisdiction and any specific legal system referenced.",
      },
      {
        index: 13,
        name: "Dispute Resolution",
        format: "text",
        prompt:
          "How are disputes resolved under this agreement? Identify whether disputes go to litigation or arbitration, the chosen forum or seat, and any mandatory escalation steps (e.g. negotiation, mediation) before formal proceedings.",
      },
    ],
  },

  // ─── SPA ─────────────────────────────────────────────────────────────────────
  {
    id: "builtin-spa",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "SPA Review",
    type: "tabular",
    practice: "Corporate",
    prompt_md: null,
    columns_config: [
      {
        index: 0,
        name: "Parties",
        format: "bulleted_list",
        prompt:
          "Identify all parties to this share purchase agreement. For each, state their full legal name, jurisdiction of incorporation (if stated), and their role (e.g. seller, buyer, target company, warrantor, guarantor).",
      },
      {
        index: 1,
        name: "Date",
        format: "date",
        prompt: "What is the date of this share purchase agreement?",
      },
      {
        index: 2,
        name: "Transaction",
        format: "text",
        prompt:
          "Summarise the transaction. What shares or interests are being acquired, in which target company or companies, and what is the nature of the transaction (e.g. 100% acquisition, majority stake, minority investment)?",
      },
      {
        index: 3,
        name: "Consideration",
        format: "monetary_amount",
        prompt:
          "What is the consideration payable under this agreement? State the total headline price, the currency, and the structure (e.g. cash, shares, loan notes, deferred consideration, earnout). If the price is subject to adjustment (e.g. locked box, completion accounts), describe the mechanism.",
      },
      {
        index: 4,
        name: "Key Conditions Precedent",
        format: "bulleted_list",
        prompt:
          "List the key conditions precedent (CPs) to completion. For each CP, state what must be satisfied or waived and by whom. Identify any long-stop date by which CPs must be satisfied.",
      },
      {
        index: 5,
        name: "Completion Date",
        format: "text",
        prompt:
          "When does completion occur? State how many business days after satisfaction or waiver of all CPs completion must occur, and/or any fixed outside date for completion. Note whether there is any obligation to complete by a specific date after signing.",
      },
      {
        index: 6,
        name: "Warranties",
        format: "text",
        prompt:
          "Summarise the warranty package. Who gives the warranties (e.g. seller, management, all sellers jointly and severally)? Are there business warranties and/or title warranties? Identify the scope of any warranty disclosure process and any limitations on warranty claims (e.g. time limits, minimum claim thresholds, aggregate cap).",
      },
      {
        index: 7,
        name: "Indemnities",
        format: "text",
        prompt:
          "Are there specific indemnities in this agreement? If so, list the key indemnities given, by whom, and for what potential liabilities (e.g. tax indemnity, environmental indemnity, litigation indemnity). Note any time limits or caps applicable to indemnity claims.",
      },
      {
        index: 8,
        name: "Limitation of Liability",
        format: "text",
        prompt:
          "What limitations on liability apply to warranty and indemnity claims? Identify the aggregate cap (and how it is calculated, e.g. as a percentage of consideration), any separate cap for fundamental warranties or indemnities, minimum claim thresholds (de minimis and basket/deductible), and time limits for bringing claims.",
      },
      {
        index: 9,
        name: "Covenants",
        format: "text",
        prompt:
          "What restrictive or other covenants are given by the seller or management? Include non-compete, non-solicitation, and non-dealing covenants, stating the scope (activities and geography) and duration of each.",
      },
      {
        index: 10,
        name: "Exclusivity",
        format: "text",
        prompt:
          "Is there an exclusivity or no-shop provision in this agreement? If so, state the period of exclusivity, what activities are restricted (e.g. soliciting competing offers, engaging with third parties), and any carve-outs or break fee arrangements.",
      },
      {
        index: 11,
        name: "Governing Law and Jurisdiction",
        format: "text",
        prompt:
          "What governing law applies to this agreement and what courts or arbitral tribunals have jurisdiction? State the chosen law, the forum for disputes, and whether jurisdiction is exclusive or non-exclusive.",
      },
      {
        index: 12,
        name: "Dispute Resolution",
        format: "text",
        prompt:
          "How are disputes to be resolved under this agreement? Identify whether disputes go to litigation or arbitration, the chosen seat or forum, the applicable rules (if arbitration), and any mandatory pre-dispute escalation steps.",
      },
    ],
  },

  // ─── NDA ─────────────────────────────────────────────────────────────────────
  {
    id: "builtin-nda",
    user_id: null,
    is_system: true,
    created_at: "",
    title: "NDA Review",
    type: "tabular",
    practice: "General Transactions",
    prompt_md: null,
    columns_config: [
      {
        index: 0,
        name: "Direction",
        format: "tag",
        tags: ["Mutual", "Unilateral"],
        prompt:
          "Is this NDA mutual (both parties owe confidentiality obligations to each other) or unilateral (only one party owes confidentiality obligations)? Identify the direction and name the disclosing and receiving party or parties.",
      },
      {
        index: 1,
        name: "Definition of Confidential Information",
        format: "text",
        prompt:
          "How is 'Confidential Information' defined in this agreement? Is it broadly or narrowly drafted? Does it require information to be marked as confidential, or is all information shared in connection with the purpose automatically covered? Note any express inclusions or exclusions.",
      },
      {
        index: 2,
        name: "Obligations of Receiving Party",
        format: "bulleted_list",
        prompt:
          "What are the key obligations of the receiving party in respect of the confidential information? List each obligation (e.g. keep confidential, not disclose to third parties, use only for the permitted purpose, apply a specific standard of care, restrict access to need-to-know personnel).",
      },
      {
        index: 3,
        name: "Standard Carveouts Present?",
        format: "yes_no",
        prompt:
          "Does the agreement include the standard carveouts to confidentiality obligations? Answer Yes if the agreement excludes information that: (a) is or becomes publicly available without breach; (b) was already known to the receiving party; (c) is independently developed; and (d) is received from a third party without restriction. Note any carveouts that are missing or are drafted differently from the standard formulation.",
      },
      {
        index: 4,
        name: "Permitted Disclosures",
        format: "bulleted_list",
        prompt:
          "To whom may the receiving party disclose confidential information? List each category of permitted recipient (e.g. employees, professional advisers, affiliates, financing parties, regulatory authorities). Note whether onward disclosure requires the recipient to be bound by equivalent obligations.",
      },
      {
        index: 5,
        name: "Term and Duration",
        format: "text",
        prompt:
          "What is the term of this NDA and how long do the confidentiality obligations last? State the initial term of the agreement and the duration of the confidentiality obligations (noting whether they survive termination and for how long).",
      },
      {
        index: 6,
        name: "Return and Destruction",
        format: "text",
        prompt:
          "What obligations apply on expiry or termination regarding return or destruction of confidential information? Is there a choice between return and destruction? Must destruction be certified? Are there any retention exceptions (e.g. for regulatory purposes, IT backup systems)?",
      },
      {
        index: 7,
        name: "Remedies",
        format: "text",
        prompt:
          "What remedies are available for breach of the confidentiality obligations? Does the agreement acknowledge that damages may be inadequate and that injunctive relief or specific performance is available? Are there any agreed liquidated damages or indemnities for breach?",
      },
      {
        index: 8,
        name: "Governing Law and Jurisdiction",
        format: "text",
        prompt:
          "What governing law applies to this agreement and which courts have jurisdiction? State the chosen law, the forum, and whether jurisdiction is exclusive or non-exclusive.",
      },
    ],
  },

  // ─── Commercial Lease ─────────────────────────────────────────────────────────
];
