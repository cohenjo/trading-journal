export type Lang = 'en' | 'he';

export const translations: Record<Lang, {
  header: {
    title: string;
    subtitle: string;
    lastUpdated: string;
    downloadPdf: string;
    generating: string;
  };
  summary: {
    title: string;
    subtitle: string;
    loading: string;
    columns: {
      category: string;
      name: string;
      institution: string;
      type: string;
      value: string;
      owner: string;
      notes: string;
    };
    categories: Record<string, string>;
    demoItems: {
      lifeInsurance: { name: string; institution: string; value: string; notes: string };
      mortgageInsurance: { name: string; institution: string; value: string; notes: string };
      healthInsurance: { name: string; institution: string; notes: string };
      carInsurance: { name: string; institution: string; notes: string };
    };
  };
  firstSteps: {
    title: string;
    subtitle: string;
    steps: Array<{ title: string; desc: string }>;
  };
  inheritance: {
    title: string;
    subtitle: string;
    whatIsIt: string;
    whereToApply: string;
    documentsNeeded: string;
    cost: string;
    timeline: string;
    tip: string;
    labels: {
      whatIsIt: string;
      whereToApply: string;
      documentsNeeded: string;
      cost: string;
      timeline: string;
    };
  };
  bituachLeumi: {
    title: string;
    subtitle: string;
    what: string;
    eligibility: string;
    howToApply: string;
    documents: string;
    phone: string;
    deadline: string;
    labels: {
      what: string;
      eligibility: string;
      howToApply: string;
      documents: string;
      phone: string;
      website: string;
    };
  };
  lifeInsurance: {
    title: string;
    subtitle: string;
    provider: string;
    sumInsured: string;
    processSteps: string[];
    note: string;
    demoTag: string;
    labels: {
      provider: string;
      sumInsured: string;
      process: string;
      website: string;
    };
  };
  mortgageInsurance: {
    title: string;
    subtitle: string;
    provider: string;
    whatItCovers: string;
    process: string;
    documents: string;
    note: string;
    demoTag: string;
    labels: {
      provider: string;
      whatItCovers: string;
      process: string;
      documents: string;
    };
  };
  pension: {
    title: string;
    subtitle: string;
    provider: string;
    whatHappens: string;
    processSteps: string[];
    timeline: string;
    tip: string;
    labels: {
      provider: string;
      whatHappens: string;
      process: string;
      timeline: string;
      website: string;
    };
  };
  ibkr: {
    title: string;
    subtitle: string;
    accountType: string;
    steps: string[];
    important: string;
    labels: {
      accountType: string;
      whatToDo: string;
      contact: string;
    };
  };
  bankAccounts: {
    title: string;
    subtitle: string;
    yourSavingsLabel: string;
    processSteps: string[];
    tip: string;
    labels: {
      generalProcess: string;
    };
  };
  government: {
    title: string;
    subtitle: string;
    harBituach: {
      title: string;
      whatItDoes: string;
      how: string;
      shows: string;
      freeOfficial: string;
      labels: {
        url: string;
        whatItDoes: string;
        howToUse: string;
        shows: string;
      };
    };
    harKesef: {
      title: string;
      whatItDoes: string;
      shows: string;
      deceasedSearch: string;
      freeOfficial: string;
      labels: {
        url: string;
        whatItDoes: string;
        shows: string;
        deceasedSearch: string;
      };
    };
    govIl: {
      title: string;
      whatItDoes: string;
      labels: {
        url: string;
        whatItDoes: string;
      };
    };
  };
  documents: {
    title: string;
    subtitle: string;
    items: string[];
  };
  contacts: {
    title: string;
    subtitle: string;
    roles: Array<{ role: string; name: string; phone: string; email: string }>;
  };
  footer: {
    lines: string[];
  };
}> = {
  en: {
    header: {
      title: 'After I Leave — Financial Guide',
      subtitle: "Everything you need to know about our finances, accounts, and how to access them. Take it one step at a time — there's no rush.",
      lastUpdated: 'Last updated:',
      downloadPdf: '📥 Download as PDF',
      generating: 'Generating…',
    },
    summary: {
      title: 'Quick Financial Summary',
      subtitle: 'All accounts, investments, and insurance at a glance',
      loading: 'Loading financial data…',
      columns: {
        category: 'Category',
        name: 'Name',
        institution: 'Institution',
        type: 'Type',
        value: 'Value',
        owner: 'Owner',
        notes: 'Notes',
      },
      categories: {
        Insurance: 'Insurance',
        Pension: 'Pension',
        Savings: 'Savings',
        Investments: 'Investments',
        Assets: 'Assets',
        Liabilities: 'Liabilities',
      },
      demoItems: {
        lifeInsurance: { name: 'Life Insurance (ביטוח חיים)', institution: 'Clal (כלל)', value: '₪2,000,000', notes: '[DEMO — Update with real data]' },
        mortgageInsurance: { name: 'Mortgage Insurance (ביטוח משכנתא)', institution: 'Migdal (מגדל)', value: 'Covers remaining mortgage', notes: '[DEMO — Update with real data]' },
        healthInsurance: { name: 'Health Insurance (ביטוח בריאות)', institution: 'Clalit + Supplementary', notes: '[DEMO — Update with real data]' },
        carInsurance: { name: 'Car Insurance (ביטוח רכב)', institution: '[Provider TBD]', notes: '[DEMO — Update with real data]' },
      },
    },
    firstSteps: {
      title: 'First Steps — What to Do Right Away',
      subtitle: 'A gentle guide for the first days and weeks',
      steps: [
        { title: "Don't rush — take your time to grieve", desc: 'There is no deadline on grief. Financial matters can wait a few weeks. Lean on family and friends.' },
        { title: 'Gather essential documents', desc: 'ID cards (תעודות זהות), marriage certificate (תעודת נישואין), death certificate (תעודת פטירה) — get multiple certified copies.' },
        { title: 'Contact our lawyer and accountant', desc: 'See the contacts section below. They can guide you through the legal and tax processes.' },
        { title: "Apply for Bituach Leumi survivors' pension (קצבת שארים)", desc: 'This provides a monthly income. See the dedicated section below for how to apply.' },
        { title: 'Check הר הביטוח and הר הכסף for the complete picture', desc: 'These free government tools show ALL insurance policies and pension funds registered under an ID number. See the Government Resources section.' },
        { title: 'Begin insurance claims — life insurance first', desc: 'Life insurance is typically the largest payout. Start this process early as it takes 30-60 days.' },
      ],
    },
    inheritance: {
      title: 'Inheritance Order (צו ירושה)',
      subtitle: 'The legal document you need for almost everything — start this first',
      whatIsIt: 'A court order that proves you are the legal heir. It is required by banks, pension funds, and insurance companies to release funds.',
      whereToApply: 'Registrar of Inheritance online portal',
      documentsNeeded: 'Death certificate, your ID, marriage certificate, two witness affidavits declaring the heirs',
      cost: '~₪507 online application fee + ₪66 publication fee',
      timeline: '2-3 months for straightforward cases (no disputes)',
      tip: "This document is needed for almost everything. Start this process as soon as possible. If we have a will, the process is called \"probate\" (צו קיום צוואה) — similar process but verifies the will.",
      labels: {
        whatIsIt: 'What is it',
        whereToApply: 'Where to apply',
        documentsNeeded: 'Documents needed',
        cost: 'Cost',
        timeline: 'Timeline',
      },
    },
    bituachLeumi: {
      title: "Bituach Leumi — Survivors' Pension (ביטוח לאומי — קצבת שארים)",
      subtitle: 'Monthly income from National Insurance',
      what: 'Monthly pension paid to the surviving spouse from the National Insurance Institute.',
      eligibility: 'Automatic for a married spouse — no minimum contribution period required.',
      howToApply: 'File a claim at your local Bituach Leumi branch, or online through the website.',
      documents: 'Death certificate, marriage certificate, both IDs, bank details for payments',
      phone: '*6050',
      deadline: 'Submit within 12 months of the date of death to receive full retroactive payments.',
      labels: {
        what: 'What',
        eligibility: 'Eligibility',
        howToApply: 'How to apply',
        documents: 'Documents needed',
        phone: 'Phone',
        website: 'Website',
      },
    },
    lifeInsurance: {
      title: 'Life Insurance Claims (ביטוח חיים)',
      subtitle: 'Claiming the life insurance payout',
      provider: 'Clal Insurance (כלל ביטוח)',
      sumInsured: '₪2,000,000',
      processSteps: [
        'Call Clal customer service or visit their website',
        'Request and fill the claim form (טופס תביעה) — download from their site',
        'Submit with: death certificate, your ID, policy number, marriage certificate, bank account details',
        "If no named beneficiary on the policy — you'll need the inheritance order",
        'Processing: 30-60 days after all documents are submitted',
      ],
      note: 'Update this section with the real policy number, exact coverage amount, and beneficiary details.',
      demoTag: 'DEMO — Update with real data',
      labels: {
        provider: 'Provider',
        sumInsured: 'Sum insured',
        process: 'Process',
        website: 'Website',
      },
    },
    mortgageInsurance: {
      title: 'Mortgage Insurance (ביטוח משכנתא)',
      subtitle: 'Covers the remaining mortgage balance',
      provider: 'Migdal (מגדל)',
      whatItCovers: "Pays off the remaining mortgage balance in full. You won't owe any more mortgage payments.",
      process: 'Contact both Migdal (the insurer) and the mortgage bank. They will coordinate the payoff.',
      documents: 'Death certificate, mortgage account details, policy number, your ID',
      note: 'Update this section with the real policy number and mortgage bank details.',
      demoTag: 'DEMO — Update with real data',
      labels: {
        provider: 'Provider',
        whatItCovers: 'What it covers',
        process: 'Process',
        documents: 'Documents needed',
      },
    },
    pension: {
      title: 'Pension Funds (קרנות פנסיה)',
      subtitle: "Survivors' pension — ongoing monthly payments",
      provider: 'Clal Pension (from existing financial data)',
      whatHappens: "The surviving spouse receives a survivors' pension — monthly payments based on the accumulated pension.",
      processSteps: [
        'Contact Clal Pension fund directly',
        'Submit a claim form with: death certificate, marriage certificate, IDs, inheritance order',
        'Notify the employer — request Form 161 (טופס 161) which details pension contributions',
      ],
      timeline: 'Submit within 12 months',
      tip: "Check if there's a lump sum component (מענק) in addition to the monthly pension. Some policies allow a one-time withdrawal alongside the ongoing payments.",
      labels: {
        provider: 'Provider',
        whatHappens: 'What happens',
        process: 'Process',
        timeline: 'Timeline',
        website: 'Website',
      },
    },
    ibkr: {
      title: 'Investments — Interactive Brokers (IBKR)',
      subtitle: 'International brokerage account — stocks, bonds, and options',
      accountType: 'Individual (non-US resident)',
      steps: [
        'Email estateprocessing@interactivebrokers.com with the account number',
        'Subject line: "Estate Processing"',
        'Required documents: certified death certificate, your government ID, inheritance order (Israeli צו ירושה with apostille), estate/probate court documents',
        'IBKR will freeze the account, then transfer assets to your name or liquidate to cash',
        'Processing: 2-4 weeks after all documents are submitted',
      ],
      important: 'For non-US accounts, there is no "Transfer on Death" option. Legal inheritance documents (צו ירושה) are required. The apostille authenticates the Israeli document for international use.',
      labels: {
        accountType: 'Account type',
        whatToDo: 'What to do',
        contact: 'Contact',
      },
    },
    bankAccounts: {
      title: 'Bank Accounts & Savings',
      subtitle: 'Israeli bank accounts and savings plans',
      yourSavingsLabel: 'Your savings accounts from the financial data:',
      processSteps: [
        'Visit the bank branch with the death certificate and inheritance order',
        'The bank will temporarily freeze the accounts',
        'After the inheritance order is issued: transfer or merge accounts to your name',
        'For joint accounts: show the death certificate — the surviving holder gets access',
      ],
      tip: 'Keep some cash accessible in a joint account for immediate living expenses. Bank freezes on individual accounts can take weeks to resolve.',
      labels: {
        generalProcess: 'General process',
      },
    },
    government: {
      title: 'Government Resources',
      subtitle: 'Free official tools to find all insurance and savings',
      harBituach: {
        title: '🛡️ הר הביטוח (Har HaBituach) — Insurance Mountain',
        whatItDoes: "Shows ALL insurance policies registered under a person's ID number — from ALL insurance companies.",
        how: 'Login with Teudat Zehut (ID number) + issue date.',
        shows: 'Life insurance, health insurance, car insurance, home insurance — everything.',
        freeOfficial: '✅ Free and official!',
        labels: { url: 'URL', whatItDoes: 'What it does', howToUse: 'How to use', shows: 'Shows' },
      },
      harKesef: {
        title: '💰 הר הכסף (Har HaKesef) — Money Mountain',
        whatItDoes: "Finds ALL pension funds, savings plans, dormant bank accounts registered under a person's identity.",
        shows: 'Pension funds, provident funds (קופות גמל), education funds (קרנות השתלמות), inactive bank accounts.',
        deceasedSearch: "You can search for a deceased person's funds with proper documentation.",
        freeOfficial: '✅ Free and official!',
        labels: { url: 'URL', whatItDoes: 'What it does', shows: 'Shows', deceasedSearch: 'Deceased search' },
      },
      govIl: {
        title: '🏛️ Gov.il Post-Death Portal',
        whatItDoes: 'Centralized government guidance for all death-related procedures, step by step.',
        labels: { url: 'URL', whatItDoes: 'What it does' },
      },
    },
    documents: {
      title: 'Important Documents Checklist',
      subtitle: "Gather these documents — you'll need them repeatedly",
      items: [
        'Death certificate (תעודת פטירה) — get multiple certified copies (at least 5)',
        'Marriage certificate (תעודת נישואין)',
        'Both ID cards (תעודות זהות)',
        'Inheritance order (צו ירושה) — apply ASAP, takes 2-3 months',
        'Bank account details (voided check or bank letter)',
        'All insurance policy numbers',
        'Employment Form 161 (טופס 161) — request from employer',
        'Attorney affidavit listing dependents (תצהיר עורך דין)',
      ],
    },
    contacts: {
      title: 'Important Contacts',
      subtitle: 'People and services to reach out to',
      roles: [
        { role: 'Lawyer (עורך דין)', name: '[Name — TO BE FILLED]', phone: '[Phone]', email: '[Email]' },
        { role: 'Accountant (רואה חשבון)', name: '[Name — TO BE FILLED]', phone: '[Phone]', email: '[Email]' },
        { role: 'Insurance Agent (סוכן ביטוח)', name: '[Name — TO BE FILLED]', phone: '[Phone]', email: '[Email]' },
        { role: 'Bank Contact', name: '[Name — TO BE FILLED]', phone: '[Phone]', email: '[Email]' },
        { role: 'Bituach Leumi', name: 'National Insurance Institute', phone: '*6050', email: 'btl.gov.il' },
      ],
    },
    footer: {
      lines: [
        "💙 This guide is here to help, not to worry you. It's just a map — so you know where to go if you ever need it.",
        'Review it once, make sure the contacts and policy numbers are up to date, and then put it away.',
        'Remember: you can always ask our lawyer or accountant for help navigating any of these steps.',
      ],
    },
  },
  he: {
    header: {
      title: 'אחרי שאעזוב — מדריך פיננסי',
      subtitle: 'כל מה שצריך לדעת על הכספים, החשבונות, ואיך לגשת אליהם. צעד אחד בכל פעם — אין לחץ.',
      lastUpdated: 'עודכן לאחרונה:',
      downloadPdf: '📥 הורדה כ-PDF',
      generating: 'מייצר...',
    },
    summary: {
      title: 'סיכום פיננסי מהיר',
      subtitle: 'כל החשבונות, ההשקעות והביטוחים במבט אחד',
      loading: 'טוען נתונים פיננסיים...',
      columns: {
        category: 'קטגוריה',
        name: 'שם',
        institution: 'מוסד',
        type: 'סוג',
        value: 'ערך',
        owner: 'בעלים',
        notes: 'הערות',
      },
      categories: {
        Insurance: 'ביטוח',
        Pension: 'פנסיה',
        Savings: 'חסכונות',
        Investments: 'השקעות',
        Assets: 'נכסים',
        Liabilities: 'התחייבויות',
      },
      demoItems: {
        lifeInsurance: { name: 'ביטוח חיים', institution: 'כלל', value: '₪2,000,000', notes: '[דמו — עדכני עם נתונים אמיתיים]' },
        mortgageInsurance: { name: 'ביטוח משכנתא', institution: 'מגדל', value: 'מכסה יתרת משכנתא', notes: '[דמו — עדכני עם נתונים אמיתיים]' },
        healthInsurance: { name: 'ביטוח בריאות', institution: 'כללית + משלים', notes: '[דמו — עדכני עם נתונים אמיתיים]' },
        carInsurance: { name: 'ביטוח רכב', institution: '[ספק — למלא]', notes: '[דמו — עדכני עם נתונים אמיתיים]' },
      },
    },
    firstSteps: {
      title: 'צעדים ראשונים — מה לעשות מיד',
      subtitle: 'מדריך עדין לימים והשבועות הראשונים',
      steps: [
        { title: 'אל תמהרי — קחי את הזמן להתאבל', desc: 'אין דדליין על אבל. עניינים פיננסיים יכולים לחכות כמה שבועות. היעזרי במשפחה ובחברים.' },
        { title: 'אספי מסמכים חיוניים', desc: 'תעודות זהות, תעודת נישואין, תעודת פטירה — השיגי מספר עותקים מאושרים.' },
        { title: 'צרי קשר עם עורך הדין ורואה החשבון שלנו', desc: 'ראי פרטי קשר בהמשך. הם יוכלו להדריך אותך בתהליכים המשפטיים והמיסויים.' },
        { title: 'הגישי בקשה לקצבת שארים בביטוח לאומי', desc: 'זה מספק הכנסה חודשית. ראי את החלק המפורט למטה.' },
        { title: 'בדקי בהר הביטוח ובהר הכסף את התמונה המלאה', desc: 'כלים ממשלתיים חינמיים שמראים את כל פוליסות הביטוח וקרנות הפנסיה הרשומות. ראי את חלק המשאבים הממשלתיים.' },
        { title: 'התחילי בתביעות ביטוח — ביטוח חיים קודם', desc: 'ביטוח חיים הוא בדרך כלל התשלום הגדול ביותר. התחילי את התהליך מוקדם כי הוא לוקח 30-60 יום.' },
      ],
    },
    inheritance: {
      title: 'צו ירושה',
      subtitle: 'המסמך המשפטי שצריך כמעט לכל דבר — התחילי עם זה קודם',
      whatIsIt: 'צו בית משפט שמוכיח שאת היורשת החוקית. נדרש על ידי בנקים, קרנות פנסיה וחברות ביטוח לשחרור כספים.',
      whereToApply: 'פורטל רשם הירושות המקוון',
      documentsNeeded: 'תעודת פטירה, תעודת זהות שלך, תעודת נישואין, שני תצהירי עדים המצהירים על היורשים',
      cost: '~₪507 אגרת הגשה מקוונת + ₪66 אגרת פרסום',
      timeline: '2-3 חודשים במקרים פשוטים (ללא מחלוקות)',
      tip: 'המסמך הזה נדרש כמעט לכל דבר. התחילי בתהליך הזה בהקדם האפשרי. אם יש לנו צוואה, התהליך נקרא \'צו קיום צוואה\' — תהליך דומה שמאמת את הצוואה.',
      labels: {
        whatIsIt: 'מה זה',
        whereToApply: 'איפה מגישים',
        documentsNeeded: 'מסמכים נדרשים',
        cost: 'עלות',
        timeline: 'לוח זמנים',
      },
    },
    bituachLeumi: {
      title: 'ביטוח לאומי — קצבת שארים',
      subtitle: 'הכנסה חודשית מהמוסד לביטוח לאומי',
      what: 'קצבה חודשית המשולמת לבן/בת הזוג מהמוסד לביטוח לאומי.',
      eligibility: 'אוטומטי לבן/בת זוג נשואים — אין צורך בתקופת הפקדה מינימלית.',
      howToApply: 'הגישי תביעה בסניף ביטוח לאומי הקרוב, או באופן מקוון דרך האתר.',
      documents: 'תעודת פטירה, תעודת נישואין, תעודות זהות, פרטי חשבון בנק לתשלומים',
      phone: '*6050',
      deadline: 'הגישי תוך 12 חודשים ממועד הפטירה לקבלת תשלומים רטרואקטיביים מלאים.',
      labels: {
        what: 'מה זה',
        eligibility: 'זכאות',
        howToApply: 'איך להגיש',
        documents: 'מסמכים נדרשים',
        phone: 'טלפון',
        website: 'אתר',
      },
    },
    lifeInsurance: {
      title: 'תביעות ביטוח חיים',
      subtitle: 'מימוש תשלום ביטוח החיים',
      provider: 'כלל ביטוח',
      sumInsured: '₪2,000,000',
      processSteps: [
        'התקשרי לשירות הלקוחות של כלל או בקרי באתר שלהם',
        'בקשי ומלאי טופס תביעה — ניתן להוריד מהאתר שלהם',
        'הגישי עם: תעודת פטירה, תעודת זהות שלך, מספר פוליסה, תעודת נישואין, פרטי חשבון בנק',
        'אם אין מוטב מוגדר בפוליסה — תצטרכי צו ירושה',
        'זמן טיפול: 30-60 יום לאחר הגשת כל המסמכים',
      ],
      note: 'עדכני את החלק הזה עם מספר הפוליסה האמיתי, סכום הכיסוי המדויק ופרטי המוטבים.',
      demoTag: 'דמו — עדכני עם נתונים אמיתיים',
      labels: {
        provider: 'ספק',
        sumInsured: 'סכום מבוטח',
        process: 'תהליך',
        website: 'אתר',
      },
    },
    mortgageInsurance: {
      title: 'ביטוח משכנתא',
      subtitle: 'מכסה את יתרת המשכנתא',
      provider: 'מגדל',
      whatItCovers: 'משלם את יתרת המשכנתא במלואה. לא תצטרכי לשלם עוד תשלומי משכנתא.',
      process: 'צרי קשר עם מגדל (המבטח) ועם הבנק למשכנתאות. הם יתאמו את הסילוק.',
      documents: 'תעודת פטירה, פרטי חשבון המשכנתא, מספר פוליסה, תעודת זהות שלך',
      note: 'עדכני את החלק הזה עם מספר הפוליסה האמיתי ופרטי הבנק למשכנתאות.',
      demoTag: 'דמו — עדכני עם נתונים אמיתיים',
      labels: {
        provider: 'ספק',
        whatItCovers: 'מה מכוסה',
        process: 'תהליך',
        documents: 'מסמכים נדרשים',
      },
    },
    pension: {
      title: 'קרנות פנסיה',
      subtitle: 'פנסיית שארים — תשלומים חודשיים שוטפים',
      provider: 'כלל פנסיה (מהנתונים הפיננסיים הקיימים)',
      whatHappens: 'בן/בת הזוג מקבל/ת פנסיית שארים — תשלומים חודשיים על בסיס הפנסיה שנצברה.',
      processSteps: [
        'צרי קשר ישירות עם קרן הפנסיה של כלל',
        'הגישי טופס תביעה עם: תעודת פטירה, תעודת נישואין, תעודות זהות, צו ירושה',
        'הודיעי למעסיק — בקשי טופס 161 שמפרט את הפקדות הפנסיה',
      ],
      timeline: 'הגישי תוך 12 חודשים',
      tip: 'בדקי אם יש מרכיב של סכום חד-פעמי (מענק) בנוסף לפנסיה החודשית. חלק מהפוליסות מאפשרות משיכה חד-פעמית לצד התשלומים השוטפים.',
      labels: {
        provider: 'ספק',
        whatHappens: 'מה קורה',
        process: 'תהליך',
        timeline: 'לוח זמנים',
        website: 'אתר',
      },
    },
    ibkr: {
      title: 'השקעות — אינטראקטיב ברוקרס (IBKR)',
      subtitle: 'חשבון ברוקרים בינלאומי — מניות, אגרות חוב ואופציות',
      accountType: 'אישי (תושב שאינו אמריקאי)',
      steps: [
        'שלחי אימייל ל-estateprocessing@interactivebrokers.com עם מספר החשבון',
        'נושא: "Estate Processing"',
        'מסמכים נדרשים: תעודת פטירה מאושרת, תעודת זהות ממשלתית שלך, צו ירושה ישראלי עם אפוסטיל, מסמכי ירושה',
        'IBKR יקפיאו את החשבון, ואז יעבירו את הנכסים על שמך או ימירו למזומן',
        'זמן טיפול: 2-4 שבועות לאחר הגשת כל המסמכים',
      ],
      important: 'לחשבונות שאינם אמריקאיים, אין אפשרות \'העברה בפטירה\'. נדרשים מסמכי ירושה חוקיים (צו ירושה). האפוסטיל מאמת את המסמך הישראלי לשימוש בינלאומי.',
      labels: {
        accountType: 'סוג חשבון',
        whatToDo: 'מה לעשות',
        contact: 'איש קשר',
      },
    },
    bankAccounts: {
      title: 'חשבונות בנק וחסכונות',
      subtitle: 'חשבונות בנק ותוכניות חיסכון ישראליות',
      yourSavingsLabel: 'חשבונות החיסכון שלך מהנתונים הפיננסיים:',
      processSteps: [
        'בקרי בסניף הבנק עם תעודת הפטירה וצו הירושה',
        'הבנק יקפיא זמנית את החשבונות',
        'לאחר הוצאת צו הירושה: העבירי או מזגי חשבונות על שמך',
        'לחשבונות משותפים: הציגי תעודת פטירה — בעל החשבון הנותר מקבל גישה',
      ],
      tip: 'שמרי מזומנים נגישים בחשבון משותף להוצאות מחייה מיידיות. הקפאות בנק על חשבונות אישיים יכולות לקחת שבועות.',
      labels: {
        generalProcess: 'תהליך כללי',
      },
    },
    government: {
      title: 'משאבים ממשלתיים',
      subtitle: 'כלים רשמיים חינמיים למציאת כל הביטוחים והחסכונות',
      harBituach: {
        title: '🛡️ הר הביטוח — מאגר ביטוחים ארצי',
        whatItDoes: 'מציג את כל פוליסות הביטוח הרשומות תחת מספר תעודת זהות — מכל חברות הביטוח.',
        how: 'התחברות עם מספר תעודת זהות + תאריך הנפקה.',
        shows: 'ביטוח חיים, ביטוח בריאות, ביטוח רכב, ביטוח דירה — הכל.',
        freeOfficial: '✅ חינם ורשמי!',
        labels: { url: 'כתובת', whatItDoes: 'מה זה עושה', howToUse: 'איך להשתמש', shows: 'מציג' },
      },
      harKesef: {
        title: '💰 הר הכסף — מאגר כספים ארצי',
        whatItDoes: 'מוצא את כל קרנות הפנסיה, תוכניות החיסכון, חשבונות בנק רדומים הרשומים תחת זהות.',
        shows: 'קרנות פנסיה, קופות גמל, קרנות השתלמות, חשבונות בנק לא פעילים.',
        deceasedSearch: 'ניתן לחפש כספים של אדם שנפטר עם תיעוד מתאים.',
        freeOfficial: '✅ חינם ורשמי!',
        labels: { url: 'כתובת', whatItDoes: 'מה זה עושה', shows: 'מציג', deceasedSearch: 'חיפוש נפטרים' },
      },
      govIl: {
        title: '🏛️ פורטל Gov.il — ליווי לאחר פטירה',
        whatItDoes: 'הדרכה ממשלתית מרוכזת לכל ההליכים הקשורים בפטירה, צעד אחר צעד.',
        labels: { url: 'כתובת', whatItDoes: 'מה זה עושה' },
      },
    },
    documents: {
      title: 'רשימת מסמכים חשובים',
      subtitle: 'אספי את המסמכים האלה — תצטרכי אותם שוב ושוב',
      items: [
        'תעודת פטירה — השיגי לפחות 5 עותקים מאושרים',
        'תעודת נישואין',
        'תעודות זהות של שנינו',
        'צו ירושה — הגישי בהקדם, לוקח 2-3 חודשים',
        'פרטי חשבון בנק (שיק מבוטל או אישור מהבנק)',
        'כל מספרי פוליסות הביטוח',
        'טופס 161 מהמעסיק — בקשי מהמעסיק',
        'תצהיר עורך דין המפרט את התלויים',
      ],
    },
    contacts: {
      title: 'אנשי קשר חשובים',
      subtitle: 'אנשים ושירותים שצריך לפנות אליהם',
      roles: [
        { role: 'עורך דין', name: '[שם — למלא]', phone: '[טלפון]', email: '[אימייל]' },
        { role: 'רואה חשבון', name: '[שם — למלא]', phone: '[טלפון]', email: '[אימייל]' },
        { role: 'סוכן ביטוח', name: '[שם — למלא]', phone: '[טלפון]', email: '[אימייל]' },
        { role: 'איש קשר בבנק', name: '[שם — למלא]', phone: '[טלפון]', email: '[אימייל]' },
        { role: 'ביטוח לאומי', name: 'המוסד לביטוח לאומי', phone: '*6050', email: 'btl.gov.il' },
      ],
    },
    footer: {
      lines: [
        '💙 המדריך הזה כאן כדי לעזור, לא להדאיג. זה פשוט מפה — כדי שתדעי לאן לפנות אם תצטרכי.',
        'עברי עליו פעם אחת, וודאי שאנשי הקשר ומספרי הפוליסות מעודכנים, ואז שמרי אותו.',
        'זכרי: תמיד אפשר לבקש עזרה מעורך הדין או רואה החשבון שלנו בכל אחד מהצעדים.',
      ],
    },
  },
};
