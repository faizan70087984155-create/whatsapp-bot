const { Lead, Reply } = require('./database');
const { generateAIResponse } = require('./llm');

// Anti-Ban: Cooldown map to prevent replying too fast to the same person
// Cooldown memory to prevent instantaneous loops (1 second cooldown)
const replyCooldowns = new Map();
const REPLY_COOLDOWN_MS = 1000; // 1 second for active back-and-forth chatting

// ==========================================
// SPINTAX ENGINE - Never repeats a message
// ==========================================
function parseSpintax(text) {
    let matches, options, random;
    const regEx = new RegExp(/{([^{}]+?)}/);
    while ((matches = regEx.exec(text)) !== null) {
        options = matches[1].split('|');
        random = Math.floor(Math.random() * options.length);
        text = text.replace(matches[0], options[random]);
    }
    return text;
}

// ==========================================
// LANGUAGE DETECTION ENGINE
// ==========================================
function detectLanguage(text) {
    // Check for Devanagari script (Hindi)
    if (/[\u0900-\u097F]/.test(text)) return 'hindi';
    
    // Common Hindi words written in English (Hinglish)
    const hindiWords = [
        'bhai', 'yaar', 'kya', 'hai', 'nahi', 'nhi', 'karo', 'kro', 'krdo', 'kaise',
        'kyun', 'kyu', 'mujhe', 'muje', 'haan', 'ji', 'acha', 'achha', 'theek', 'thik',
        'dekho', 'batao', 'bolo', 'bol', 'pehle', 'phle', 'abhi', 'kab', 'kitna',
        'paisa', 'paise', 'de', 'do', 'dedo', 'dijiye', 'chahiye', 'chaiye', 'lena',
        'dena', 'rehne', 'ruko', 'mat', 'aur', 'toh', 'wo', 'woh', 'iska', 'uska',
        'kuch', 'sab', 'bahut', 'bohot', 'accha', 'bura', 'purana', 'naya', 'wala',
        'apna', 'hamara', 'tumhara', 'aapka', 'sir', 'madam', 'sahab', 'bhaiya',
        'milega', 'hoga', 'hua', 'gaya', 'aaya', 'laga', 'chala', 'chal', 'samajh',
        'smjh', 'btao', 'btdo', 'krna', 'krenge', 'karenge', 'hum', 'tum', 'mere',
        'tera', 'mera', 'iske', 'uske', 'koi', 'kon', 'kaun', 'kidhar', 'wahan',
        'yahan', 'udhar', 'idhar', 'sahi', 'galat', 'arre', 'oye', 'banda', 'log',
        'loge', 'dunga', 'denge', 'lenge', 'karenge', 'jaayega', 'jayega', 'hojayega',
        'hogaya', 'hogya', 'krdia', 'kardiya', 'bhej', 'bhejo', 'bhejna', 'manga',
        'order', 'traffic', 'wapis', 'wapas', 'vapas', 'dobara', 'firse', 'phirse'
    ];
    
    const words = text.toLowerCase().split(/\s+/);
    let hindiCount = 0;
    for (const word of words) {
        if (hindiWords.includes(word.replace(/[^a-zA-Z]/g, ''))) {
            hindiCount++;
        }
    }
    
    // If more than 30% of words are Hindi, treat as Hinglish
    if (hindiCount / Math.max(words.length, 1) > 0.3) return 'hinglish';
    if (hindiCount >= 2) return 'hinglish';
    
    return 'english';
}

// ==========================================
// RESPONSE TEMPLATES BY LANGUAGE & INTENT
// ==========================================
const RESPONSES = {
    // ===== ABUSIVE HANDLING =====
    abusive: {
        english: [
            "{I understand your frustration and I appreciate your feedback|I hear your concerns completely and respect where you are coming from} {I want to ensure we maintain a professional and positive environment|My goal is to build a constructive partnership with you} {I will go ahead and remove your contact from our outreach list to respect your space|I have updated our records so you won't receive further updates} {Wishing you great success in all your future projects|I truly wish you the best in scaling your business}",
            "{I value your honesty and completely understand your reaction|I respect your perspective and your time} {Professionalism and your comfort are our top priorities|We only want to engage with partners who find our services valuable} {I have permanently opted your number out of our communications|You have been removed from our network list immediately} {Have a highly productive and successful week ahead|Wishing you the best moving forward}"
        ],
        hinglish: [
            "{Main aapka frustration poori tarah samajh sakta hoon aur aapke waqt ki respect karta hoon|Aapki baat bilkul samajh aayi aur main iski respect karta hoon} {Humara aim hamesha ek professional aur positive partnership build karna hota hai|Humara focus hamesha ek healthy aur professional relation rakhna hai} {Main aapka contact apni list se remove kar raha hoon taaki aapka waqt bache|Aapko aage se humari taraf se koi updates nahi aayenge ye maine ensure kar diya hai} {Aapke future projects ke liye bahut saari shubhkamnayein|Aapke business ki growth ke liye best wishes}",
            "{Main aapki honesty appreciate karta hoon|Aapki baat bilkul clear hai aur main agree karta hoon} {Aapka comfort aur professionalism humare liye sabse important hai|Hum sirf ek positive network build karne mein believe karte hain} {Maine aapka number permanently remove kar diya hai|Aapka contact securely opt-out kar diya gaya hai} {Aapka din aur business dono successful rahe yahi umeed hai|Aapke future endeavors ke liye all the best}"
        ],
        hindi: [
            "{मैं आपकी बात पूरी तरह समझता हूं और आपके समय का सम्मान करता हूं|आपकी बात बिल्कुल स्पष्ट है और मैं इसका आदर करता हूं} {हमारा उद्देश्य हमेशा एक पेशेवर और सकारात्मक संबंध बनाना होता है|हम हमेशा professional तरीके से काम करने में विश्वास रखते हैं} {मैंने आपका नंबर हमारी लिस्ट से हटा दिया है ताकि आपका समय बचे|आपको आगे से हमारी तरफ से कोई संदेश नहीं मिलेगा} {आपके भविष्य के सभी प्रोजेक्ट्स के लिए बहुत शुभकामनाएं|आपके business की सफलता के लिए शुभकामनाएं}"
        ]
    },

    // ===== COMPLAINT - STAGE 1 (Empathy + New Acquisition + 100K Bonus) =====
    complaint_stage1: {
        english: [
            "{I completely understand why you feel that way based on your past experience|Your feedback is extremely valuable and I understand your hesitation} {I want to share an important update: SafeTrafficPro was recently acquired by a completely new management team|What you should know is that our platform has recently undergone a complete acquisition by new management} {While we cannot access the legacy data from the previous owners we are fully committed to proving our new standard of excellence|Since we inherited the brand without the old database our focus is entirely on showing you how much better the new system is} {As a gesture of goodwill and to start our new partnership on a positive note I am offering you a complimentary 100K premium traffic bonus on your next campaign|To demonstrate our commitment to your success I would love to add a 100K premium traffic bonus completely free on your next order} {Would you be open to experiencing the new SafeTrafficPro with this added benefit|I invite you to test our upgraded system with this risk-free bonus what do you think}",
            "{I hear exactly what you are saying and your concerns are completely valid|I appreciate you sharing this context with me it helps me understand your position} {SafeTrafficPro is now under entirely new ownership with a fully upgraded infrastructure|We recently took over SafeTrafficPro and have completely revamped the entire delivery network} {Because the previous management did not hand over past records we are focusing all our energy on building new reliable partnerships|Without access to the old legacy data our priority is proving our new premium capabilities to clients like you} {To show you exactly what our new technology can do I am authorizing a 100K bonus traffic allocation for your next order|I want to personally bridge this gap by offering a 100K premium traffic bonus on your next campaign to let the results speak for themselves} {Shall we set up a small test run so you can see the difference firsthand|I would be thrilled to show you the new results would you be open to a small test}"
        ],
        hinglish: [
            "{Aapka past experience sunkar main totally aapki hesitation samajh sakta hoon|Aapki baat bilkul valid hai aur main aapke point of view ko respect karta hoon} {Main aapko ek important update dena chahta hoon: SafeTrafficPro ko recently ek nayi management ne acquire kiya hai|Aapko batana chahunga ki humari company ab completely naye ownership aur management ke under hai} {Purani team ne apna data transfer nahi kiya tha isliye humara poora focus ab naye aur premium results deliver karne par hai|Legacy records hamare paas nahi hain isliye humara mission ab sirf aapko best-in-class results prove karna hai} {Ek positive nayi shuruwat ke liye main aapke next order par 100K premium traffic bonus apni taraf se add karna chahta hoon|Aapko humari nayi quality dikhane ke liye main aapke agle order par 100K traffic ka ek massive bonus free add karunga} {Kya aap naye system ko is bonus ke saath test karna chahenge|Main chahunga aap is upgraded service ko ek baar experience karein kya kehte hain aap}",
            "{Main aapka point poori tarah samajh raha hoon aur aapka concern bilkul natural hai|Aapne jo bataya uske baad aapka doubt bilkul samajh aata hai} {SafeTrafficPro ab completely naye owners aur ek highly advanced system ke under operate kar raha hai|Humne recently is platform ko take over karke iska poora infrastructure upgrade kiya hai} {Purane management ka data available nahi hai isliye hum practical results ke through apna trust build kar rahe hain|Kyunki purana data exist nahi karta hum actions ke through apni nayi quality prove karne me believe karte hain} {Isi trust ko banane ke liye main personally aapke next order par 100K premium traffic ka bonus offer kar raha hoon|Nayi partnership ki shuruwat ke taur par main aapko 100K free premium traffic ka bonus allocate kar raha hoon} {Ek chota sa test campaign run karke dekhein aapko difference khud nazar aayega|Kya aap humari nayi service ko is added benefit ke saath try karna chahenge}"
        ],
        hindi: [
            "{आपका पिछला अनुभव सुनकर मैं आपकी बात पूरी तरह समझ सकता हूं|आपकी बात बिल्कुल valid है और मैं आपके नज़रिए का सम्मान करता हूं} {मैं आपको एक महत्वपूर्ण जानकारी देना चाहता हूं: SafeTrafficPro को हाल ही में एक नए प्रबंधन ने acquire किया है|हमारी कंपनी अब पूरी तरह से नए ownership के तहत काम कर रही है} {चूंकि पुराने प्रबंधन ने पुराना डेटा हमें नहीं सौंपा इसलिए हमारा पूरा फोकस अब आपको बेहतरीन परिणाम देने पर है} {एक सकारात्मक नई शुरुआत के लिए मैं आपके अगले ऑर्डर पर 100K premium traffic bonus अपनी तरफ से देना चाहूंगा} {क्या आप हमारे इस नए और बेहतर सिस्टम को इस बोनस के साथ test करना चाहेंगे}"
        ]
    },

    // ===== COMPLAINT - STAGE 2 (Persuasion) =====
    complaint_stage2: {
        english: [
            "{I completely respect your careful approach to this|Your cautious approach is exactly what makes you a smart business owner} {What I can guarantee is that our newly engineered traffic network is delivering unprecedented results for our top clients|The new infrastructure we have built is currently providing the safest and most effective SEO push in the industry} {The 100K bonus is designed specifically to remove your risk and let our premium delivery do the talking|By utilizing the 100K bonus you are essentially testing our upgraded capabilities with incredible leverage} {Even a minimal test campaign will demonstrate the massive difference in quality|Once you see the analytics from our new system I am confident you will see the value} {I am here for a long-term partnership whenever you are ready to take the next step|I look forward to the opportunity to prove this to you when the time is right}",
            "{I highly value your standards and I wouldn't expect anything less|I appreciate your high expectations and we are fully equipped to meet them} {Our new management has invested heavily to ensure every single campaign is monitored and optimized for Google Discover|We have completely revolutionized the backend to ensure 100 percent safe and organic-looking metrics} {This is exactly why the 100K bonus is on the table to provide you with undeniable proof of our new quality|The 100K bonus is our investment in earning your long-term business} {I encourage you to try a small package just to monitor the analytics yourself|A simple test run is all it takes to see the complete transformation of our service} {Let me know if you would like to proceed with setting up a highly optimized test campaign|I am ready to personally oversee your campaign whenever you give the green light}"
        ],
        hinglish: [
            "{Main aapki careful approach ki poori respect karta hoon|Aapka ye cautious nature hi ek smart business decision ka proof hai} {Main aapko assure kar sakta hoon ki humara naya engineered network industry me sabse premium results de raha hai|Humne jo naya infrastructure banaya hai wo is waqt sabse safe aur effective SEO traffic deliver kar raha hai} {Ye 100K bonus specially isliye hai taaki aap bina kisi risk ke humari quality test kar sakein|100K bonus ka main purpose yahi hai ki aap humare naye system ki power ko practically dekh sakein} {Ek chota sa test campaign bhi aapko humari nayi quality ka clear proof de dega|Jab aap khud apne analytics check karenge toh aapko difference exactly samajh aayega} {Main ek long-term partnership ke liye yahan hoon jab bhi aap ready hon bataiyega|Jab bhi aap comfortable hon main aapke naye campaign ko personally manage karne ke liye ready hoon}",
            "{Main aapke high standards ko samajhta hoon aur hum unhe meet karne ke liye fully ready hain|Aapki expectations bilkul sahi hain aur humara naya system unhe exceed karne ke liye design kiya gaya hai} {Nayi management ne Google Discover safe traffic ensure karne ke liye backend me massive upgrades kiye hain|Humne apne delivery system ko poori tarah revolutionize kiya hai taaki organic metrics maintain rahein} {Isi quality ko prove karne ke liye ye 100K bonus aapko offer kiya gaya hai|Ye 100K bonus humara investment hai aapke trust aur long-term business ko jeetne ke liye} {Main suggest karunga ki aap ek basic package ke saath test karein aur khud results analyze karein|Sirf ek simple test campaign se aapko humari nayi service ka level pata chal jayega} {Aap jab bhi green signal denge main aapka campaign personally set up aur optimize karunga|Agar aap test campaign start karna chahein toh mujhe zaroor bataiyega}"
        ],
        hindi: [
            "{मैं आपकी careful approach का पूरा सम्मान करता हूं|आपका यह cautious रवैया बिल्कुल सही है} {मैं आपको आश्वस्त कर सकता हूं कि हमारा नया नेटवर्क इंडस्ट्री में सबसे बेहतरीन परिणाम दे रहा है|हमारा नया इंफ्रास्ट्रक्चर इस वक्त सबसे सुरक्षित SEO ट्रैफिक दे रहा है} {यह 100K बोनस विशेष रूप से इसलिए है ताकि आप बिना किसी रिस्क के हमारी क्वालिटी को परख सकें} {एक छोटा सा टेस्ट कैंपेन भी आपको हमारी नई क्वालिटी का स्पष्ट प्रमाण दे देगा} {जब भी आप तैयार हों मैं एक long-term partnership के लिए यहां हूं}"
        ]
    },

    // ===== COMPLAINT - STAGE 3 (Final Professional Pitch) =====
    complaint_stage3: {
        english: [
            "{I deeply respect your decision and your time|I value the time you have taken to share your thoughts with me} {My objective was simply to introduce you to the completely revamped SafeTrafficPro under our new corporate ownership|My only goal was to showcase the incredible improvements the new management has brought to the platform} {We are building highly successful campaigns for leading publishers daily and the 100K bonus will always remain available for your first order|Our new systems are performing flawlessly for our partners and my offer for the 100K bonus stands permanently for you} {I will step back now but please keep us in mind for your future scaling needs|I will not take any more of your time but our doors are always open for a highly profitable partnership} {Wishing you exceptional growth and success moving forward|Have a fantastic week and tremendous success with your business}",
            "{I appreciate your transparency and I respect your stance completely|Thank you for your candid feedback I hold that in high regard} {It has been a pleasure explaining the massive upgrades our new management has implemented|I am glad I could at least share how much the platform has evolved under the new acquisition} {We let our analytics and results do the talking and I am confident you would be impressed if you ever choose to test us|Our focus is entirely on premium delivery and I know our new system would exceed your expectations} {Whenever you are ready to scale with a reliable partner I will be right here|If your traffic needs ever grow we would be honored to provide you with top-tier service} {Wishing you the absolute best in all your future business endeavors|I wish you immense success and a highly productive year ahead}"
        ],
        hinglish: [
            "{Main aapke decision aur aapke waqt ki poori respect karta hoon|Aapne jo apna waqt nikal kar mujhe reply kiya main uski respect karta hoon} {Mera objective sirf aapko nayi management ke under upgraded SafeTrafficPro se introduce karwana tha|Main bas aapko ye batana chahta tha ki naye ownership ke baad platform kitna advanced ho chuka hai} {Hum daily top publishers ke liye highly successful campaigns run kar rahe hain aur aapka 100K bonus hamesha aapke pehle order ke liye valid rahega|Humare naye partners ko excellent results mil rahe hain aur aapke liye mera 100K bonus ka offer hamesha open rahega} {Main abhi ke liye step back karta hoon par future me scaling ke liye humein zaroor yaad rakhiyega|Aapka aur waqt nahi loonga par ek profitable partnership ke liye humare doors hamesha open hain} {Aapke business ki exceptional growth aur success ke liye meri best wishes|Aapka aane wala waqt bahut successful rahe yahi meri shubhkamnayein hain}",
            "{Aapki transparency ke liye shukriya aur main aapke stance ko respect karta hoon|Aapke clear feedback ke liye thank you main iski value karta hoon} {Mujhe khushi hai ki main aapko nayi management ke massive upgrades ke baare me bata paya|Ye explain karke acha laga ki naye acquisition ke baad humne quality ko kitna improve kiya hai} {Humare results khud bolte hain aur mujhe yakeen hai ki jab bhi aap test karenge aap impress zaroor honge|Humara poora focus premium delivery par hai aur naya system definitely aapki expectations cross karega} {Jab bhi aap ek reliable partner ke saath scale karne ke liye ready hon main yahan available rahoonga|Future me kabhi bhi premium traffic ki requirement ho toh humein zaroor bataiyega} {Aapke sabhi business projects ke liye meri taraf se absolute best wishes|Aapko bahut saari success mile yahi meri umeed hai}"
        ],
        hindi: [
            "{मैं आपके निर्णय और आपके समय का पूरा सम्मान करता हूं|आपने जो अपना समय निकालकर मुझे जवाब दिया मैं उसकी कद्र करता हूं} {मेरा उद्देश्य सिर्फ आपको नए प्रबंधन के तहत upgraded SafeTrafficPro से परिचित कराना था} {हम रोज़ाना शीर्ष पब्लिशर्स के लिए सफल कैंपेन चला रहे हैं और आपका 100K बोनस हमेशा आपके पहले ऑर्डर के लिए मान्य रहेगा} {मैं अभी के लिए पीछे हटता हूं लेकिन भविष्य में scaling के लिए हमें जरूर याद रखिएगा} {आपके business की शानदार ग्रोथ और सफलता के लिए मेरी शुभकामनाएं}"
        ]
    },

    // ===== WHO ARE YOU =====
    who_are_you: {
        english: [
            "{I appreciate you asking and I should have properly introduced myself first|Thank you for asking please allow me to formally introduce myself} {I am Abhijeet Sharma representing the strategic outreach team at SafeTrafficPro|My name is Abhijeet Sharma and I manage premium client relations for SafeTrafficPro} {I reached out because you are part of my professional network and we have just rolled out a highly exclusive 20 percent discount on our elite website traffic services|Your contact is in my professional network and I wanted to personally share our new 20 percent discount on premium SEO traffic} {You can review the complete details of our service here: https://safetrafficpro.com/product/website-traffic/|I invite you to explore the benefits of our platform here: https://safetrafficpro.com/product/website-traffic/} {I am confident this can add significant value to your digital growth strategy|I firmly believe our service can be a powerful asset for scaling your current projects}",
            "{That is a very fair question please excuse my direct approach|I apologize for not providing a proper introduction right away} {I am Abhijeet Sharma leading the client success initiatives at SafeTrafficPro|This is Abhijeet Sharma from the growth division at SafeTrafficPro} {We specialize in delivering highly secure Google Discover optimized traffic to premium publishers|Our platform focuses exclusively on providing safe organic-looking traffic that boosts SEO metrics} {I contacted you to share a limited-time 20 percent discount that I thought could be highly beneficial for your current portfolio|I wanted to ensure you had first access to our new 20 percent discount on all premium traffic packages} {Feel free to examine our offerings at your convenience: https://safetrafficpro.com/product/website-traffic/|All the details can be found right here: https://safetrafficpro.com/product/website-traffic/} {I would be delighted to discuss how we can partner for your success|Let me know if you would like to explore how this can optimize your website's performance}"
        ],
        hinglish: [
            "{Aapka poochna bilkul sahi hai aur mujhe pehle properly introduce karna chahiye tha|Poochne ke liye shukriya main pehle apna introduction de deta hoon} {Main Abhijeet Sharma hoon SafeTrafficPro ki strategic outreach team se|Mera naam Abhijeet Sharma hai aur main SafeTrafficPro ke premium client relations manage karta hoon} {Aapka contact mere professional network mein tha isliye maine socha aapko humare naye 20 percent discount ke baare me personally bataun|Main aapse isliye connect kar raha hoon kyunki humne apne elite SEO traffic par ek exclusive 20 percent discount launch kiya hai} {Aap humari service ki poori details yahan review kar sakte hain: https://safetrafficpro.com/product/website-traffic/|Aap is link par humare premium packages check kar sakte hain: https://safetrafficpro.com/product/website-traffic/} {Mujhe poora yakeen hai ki ye aapki digital growth strategy me ek massive value add karega|Main confident hoon ki ye service aapke current projects ko scale karne me bahut help karegi}",
            "{Ye ek bahut valid question hai please mere direct approach ko excuse karein|Introduction na dene ke liye main maafi chahunga} {Main Abhijeet Sharma hoon SafeTrafficPro ka client success manager|Main Abhijeet Sharma baat kar raha hoon SafeTrafficPro ki growth division se} {Hum top publishers ko highly secure aur Google Discover optimized traffic deliver karne me specialize karte hain|Humara platform exclusive organic-looking traffic provide karta hai jo SEO metrics ko boost karta hai} {Maine aapko isliye message kiya taaki aapko humare limited-time 20 percent discount ka benefit mil sake|Main chahta tha ki aapko humare naye 20 percent discount offer ka first access mile} {Aap apne convenience ke hisaab se details yahan examine kar sakte hain: https://safetrafficpro.com/product/website-traffic/|Humari saari premium offerings aap yahan dekh sakte hain: https://safetrafficpro.com/product/website-traffic/} {Mujhe bahut khushi hogi agar hum aapki success ke liye ek strong partnership build kar sakein|Aap jab bhi free hon hum discuss kar sakte hain ki ye aapki website ki performance ko kaise optimize karega}"
        ],
        hindi: [
            "{आपका पूछना बिल्कुल सही है और मुझे पहले अपना परिचय देना चाहिए था|पूछने के लिए धन्यवाद कृपया मुझे अपना परिचय देने दें} {मैं Abhijeet Sharma हूं SafeTrafficPro की टीम से|मेरा नाम Abhijeet Sharma है और मैं SafeTrafficPro के premium client relations देखता हूं} {आपका संपर्क मेरे professional नेटवर्क में था इसलिए मैंने सोचा आपको हमारे नए 20 percent डिस्काउंट के बारे में बताऊं} {आप हमारी सर्विस की पूरी जानकारी यहां देख सकते हैं: https://safetrafficpro.com/product/website-traffic/} {मुझे पूरा यकीन है कि यह आपकी डिजिटल ग्रोथ में बहुत बड़ी value जोड़ेगा}"
        ]
    },

    // ===== PRICING =====
    pricing: {
        english: [
            "{I am glad you asked about our pricing structure|Thank you for inquiring about our packages} {We have engineered our pricing to be highly scalable offering premium value across different investment levels|Our packages are carefully structured to provide maximum ROI whether you are testing or scaling massively} {The core advantage of our traffic is its exceptional quality—it is fully optimized to enhance your SEO and safely trigger Google Discover|What truly sets us apart is the organic safety of our traffic ensuring long-term SEO benefits and Discover visibility} {By utilizing the current 20 percent discount our premium delivery becomes the most competitive solution in the market|With the 20 percent off offer currently active you are securing elite traffic at an unbeatable rate} {You can review the full pricing tiers right here: https://safetrafficpro.com/product/website-traffic/|Please feel free to examine our detailed pricing options here: https://safetrafficpro.com/product/website-traffic/} {I would be more than happy to recommend a specific package based on your current analytics goals|Let me know your target metrics and I will personally help you select the most optimal package}",
            "{I would be delighted to break down our pricing for you|I am happy to provide you with all the pricing details} {Transparency is a core value for us so our pricing is straightforward with zero hidden fees|We believe in complete transparency which is why our packages are clearly defined based on traffic volume} {Every package is powered by our advanced network designed to deliver safe consistent and highly engaging visitors|Regardless of the tier you choose you receive our highest quality Google Discover safe traffic} {The active 20 percent discount allows you to leverage this premium infrastructure very cost-effectively|Factoring in the 20 percent discount this is strategically the best time to initiate a campaign} {All package details and investments are outlined here: https://safetrafficpro.com/product/website-traffic/|You can find the complete investment breakdown here: https://safetrafficpro.com/product/website-traffic/} {Whenever you are ready I am here to help tailor the perfect setup for your website|I look forward to discussing which tier aligns best with your scaling objectives}"
        ],
        hinglish: [
            "{Mujhe khushi hai ki aapne humari pricing structure ke baare me pucha|Aapke pricing inquiry ke liye shukriya} {Humne apni pricing ko highly scalable rakha hai jo alag-alag investment levels par premium value deti hai|Humare packages is tarah design kiye gaye hain ki aapko maximum ROI mile chahe aap test kar rahe hon ya scale} {Humare traffic ka sabse bada advantage iski exceptional quality hai jo SEO aur Google Discover ke liye fully optimized hai|Humari premium safety hi humein alag banati hai jo aapke SEO ko long-term benefits deti hai} {Current 20 percent discount ke saath humara premium traffic market me sabse competitive solution ban jata hai|Is 20 percent off offer ke chalte aapko elite traffic unbeatable rates par mil raha hai} {Aap saare pricing tiers yahan review kar sakte hain: https://safetrafficpro.com/product/website-traffic/|Aap humare detailed pricing options is link par dekh sakte hain: https://safetrafficpro.com/product/website-traffic/} {Agar aap apne analytics goals share karein toh main personally aapko best package recommend karunga|Aap mujhe apne targets bataiye main aapko sabse optimal setup suggest kar doonga}",
            "{Main aapko humari pricing details explain karne me khushi mehsoos karunga|Mujhe aapko saari pricing details batane me acha lagega} {Transparency humara core principle hai isliye humari pricing bilkul straightforward hai bina kisi hidden fees ke|Hum complete transparency me believe karte hain isliye saare packages clearly defined hain} {Har package humare advanced network se powered hai jo safe aur highly engaging visitors deliver karta hai|Aap koi bhi tier choose karein aapko humari highest quality Google Discover safe traffic hi milegi} {Active 20 percent discount ki wajah se aap is premium infrastructure ko bahut cost-effectively use kar sakte hain|20 percent discount ke saath ye ek campaign initiate karne ka sabse strategic time hai} {Saare package details aur investments yahan outlined hain: https://safetrafficpro.com/product/website-traffic/|Aap complete investment breakdown yahan dekh sakte hain: https://safetrafficpro.com/product/website-traffic/} {Jab bhi aap ready hon main aapki website ke liye perfect setup tailor karne me help karunga|Main aapse discuss karne ka wait karunga ki kaun sa tier aapke objectives ke liye best rahega}"
        ],
        hindi: [
            "{मुझे खुशी है कि आपने हमारी pricing के बारे में पूछा|आपके pricing inquiry के लिए धन्यवाद} {हमने अपनी pricing को highly scalable रखा है जो हर investment level पर premium value देती है} {हमारे ट्रैफिक की सबसे बड़ी खासियत इसकी क्वालिटी है जो SEO और Google Discover के लिए fully optimized है} {वर्तमान 20 percent डिस्काउंट के साथ हमारा प्रीमियम ट्रैफिक मार्केट में सबसे competitive समाधान बन जाता है} {आप सारे pricing tiers यहां देख सकते हैं: https://safetrafficpro.com/product/website-traffic/} {अगर आप अपने लक्ष्य बताएं तो मैं personally आपको best package recommend करूंगा}"
        ]
    },

    // ===== NOT INTERESTED / STOP =====
    not_interested: {
        english: [
            "{I completely respect your decision and appreciate you letting me know|I value your time and respect your preference entirely|Your transparency is highly appreciated and I respect your stance} {I will update our systems immediately so you will not receive further outreach from us|I have made a note in our records to ensure we do not contact you again} {Should your strategic needs ever change in the future our premium network will always be here to support you|If you ever find yourself looking for a reliable traffic partner down the road my door is always open} {I wish you tremendous success with all your current and future projects|Have a highly productive year ahead and best of luck with your business}",
            "{I absolutely understand and I thank you for being straightforward|I appreciate your clear communication and respect your choice|It is completely understandable and I value your honesty} {Your contact information has been opted out of our outreach initiatives|I have immediately removed you from our communication list to respect your time} {We are constantly evolving so if you ever need elite traffic solutions later on feel free to reach out|I will step back now but please know that we are always available if your traffic requirements change} {Wishing you the absolute best in scaling your enterprise|Take care and I wish you exceptional growth moving forward}"
        ],
        hinglish: [
            "{Main aapke decision ki poori respect karta hoon aur aapke waqt ke liye shukriya|Main aapki preference ko completely respect karta hoon aur samajhta hoon} {Main apne systems abhi update kar raha hoon taaki aage se aapko humari taraf se koi outreach na aaye|Maine apne records me note kar liya hai taaki aapko dobara contact na kiya jaye} {Agar future me kabhi aapki strategic needs change hoti hain toh humara premium network humesha aapki support ke liye yahan hai|Agar aage chalkar aapko ek reliable traffic partner ki zaroorat pade toh aap humein kabhi bhi reach out kar sakte hain} {Aapke current aur future projects ke liye meri taraf se bahut saari shubhkamnayein|Aapka business bahut successful rahe yahi meri umeed hai}",
            "{Main bilkul samajhta hoon aur aapke clear communication ke liye thank you|Aapki honesty ke liye shukriya main aapke decision ki value karta hoon} {Aapka contact humari outreach initiatives se opt-out kar diya gaya hai|Aapke waqt ki respect karte hue maine aapka number list se hata diya hai} {Hum continuously grow kar rahe hain agar future me aapko elite traffic solutions chahiye hon toh free feel karein|Main abhi ke liye step back karta hoon par hum aapki help ke liye hamesha available rahenge} {Aapke business ko scale karne ke safar me meri best wishes aapke saath hain|Aap exceptional growth achieve karein aisi meri shubhkamnayein hain}"
        ],
        hindi: [
            "{मैं आपके निर्णय का पूरा सम्मान करता हूं और आपके समय के लिए धन्यवाद|मैं आपकी preference का पूरी तरह से सम्मान करता हूं} {मैं अपने सिस्टम को अभी अपडेट कर रहा हूं ताकि आगे से आपको हमारी तरफ से कोई संदेश न आए} {अगर भविष्य में कभी आपको एक reliable ट्रैफिक पार्टनर की जरूरत पड़े तो आप हमें कभी भी संपर्क कर सकते हैं} {आपके वर्तमान और भविष्य के प्रोजेक्ट्स के लिए मेरी तरफ से बहुत सारी शुभकामनाएं}"
        ]
    },

    // ===== AD LIMIT =====
    ad_limit: {
        english: [
            "{I completely understand how disruptive ad limits can be to your revenue stream|Ad limits are a significant operational hurdle and I completely understand your frustration} {The strategic advantage of our premium traffic is that it is specifically engineered to help resolve these exact issues|What makes our service highly relevant here is that it is perfectly designed to help lift these ad limit restrictions} {By delivering highly secure organic-looking traffic we help normalize your account's CTR and signal safety to the ad networks|Our traffic mimics genuine human behavior consistently which balances your metrics and often expedites the removal of the limit} {Many of our top publisher clients utilize our smaller packages specifically as a safe method to restore their account standing|Executing a small calculated test campaign is a proven strategy among our partners to clear ad limits efficiently} {Would you be open to initiating a small test run to see the positive impact on your metrics|I highly recommend a minimal test package to evaluate the results yourself how does that sound}",
            "{I recognize that ad limits are a common and challenging issue for many publishers right now|I hear you completely managing ad limits requires a very strategic approach} {This is precisely why our premium website traffic is in such high demand among professional publishers|Our traffic infrastructure was built with these exact safety compliance metrics in mind} {Providing safe consistent and high-quality visitors helps clean your account's history and naturally lifts the restriction|By stabilizing your CTR with our elite traffic the ad networks receive the positive signals needed to remove the limit} {The safest route is often to start with a basic package to monitor the recovery of your account firsthand|A modest test campaign allows you to safely observe the normalization of your metrics without high risk} {Let me know if you would like me to help you set up an optimized test campaign to resolve this|I would be glad to guide you through setting up a small recovery campaign whenever you are ready}"
        ],
        hinglish: [
            "{Main poori tarah samajhta hoon ki ad limits aapke revenue ko kitna disrupt kar sakti hain|Ad limits sach me ek bada operational hurdle hai aur main aapka concern samajh raha hoon} {Humare premium traffic ka strategic advantage yahi hai ki ye inhi issues ko resolve karne ke liye engineer kiya gaya hai|Humari service is situation me highly relevant hai kyunki ye ad limits ko hatane me bahut effective hai} {Highly secure aur organic-looking traffic deliver karke hum aapke account ka CTR normalize karte hain jo ad networks ko safety signal deta hai|Humara traffic genuine human behavior mimic karta hai jisse aapke metrics balance hote hain aur limit jaldi remove ho jati hai} {Humare bahut se top publisher clients account ko normal karne ke liye initially chote packages ka hi use karte hain|Ek chota aur calculated test campaign run karna ad limits ko clear karne ki ek proven strategy hai} {Kya aap apne metrics par iska positive impact dekhne ke liye ek chota test run initiate karna chahenge|Main strongly recommend karunga ki aap ek minimal test package se evaluate karein aapka kya khayal hai}",
            "{Main recognize karta hoon ki ad limits aajkal publishers ke liye ek common aur challenging issue ban gaya hai|Aapki baat bilkul sahi hai ad limits ko manage karna ek bahut strategic approach maangta hai} {Isi wajah se professional publishers ke beech humare premium website traffic ki itni zyada demand hai|Humara traffic infrastructure specially inhi safety compliance metrics ko dhyan me rakh kar banaya gaya hai} {Safe consistent aur high-quality visitors provide karne se aapke account ki history clean hoti hai aur restriction naturally hatt jati hai|Humare elite traffic se aapka CTR stabilize hota hai jisse ad networks ko positive signals milte hain} {Sabse safe route yahi hota hai ki ek basic package ke saath start kiya jaye taaki aap account ki recovery personally monitor kar sakein|Ek modest test campaign se aap bina kisi high risk ke apne metrics ko normal hote dekh sakte hain} {Agar aap chahein toh main is issue ko resolve karne ke liye ek optimized test campaign set up karne me aapki help kar sakta hoon|Jab bhi aap ready hon ek choti recovery campaign set up karne me mujhe aapko guide karke bahut khushi hogi}"
        ],
        hindi: [
            "{मैं पूरी तरह समझता हूं कि ad limits आपके revenue को कितना प्रभावित कर सकती हैं|Ad limits सच में एक बड़ा issue है और मैं आपकी चिंता समझ रहा हूं} {हमारे प्रीमियम ट्रैफिक का फायदा यही है कि यह इन्हीं समस्याओं को हल करने के लिए बनाया गया है} {सुरक्षित और organic ट्रैफिक देकर हम आपके अकाउंट का CTR सामान्य करते हैं जो ad networks को safety signal देता है} {हमारे बहुत से टॉप पब्लिशर क्लाइंट्स अकाउंट को नॉर्मल करने के लिए छोटे packages का ही इस्तेमाल करते हैं} {क्या आप अपने metrics पर इसका सकारात्मक प्रभाव देखने के लिए एक छोटा टेस्ट रन शुरू करना चाहेंगे}"
        ]
    },

    // ===== GENERIC (Fallback when LLM hits Rate Limits) =====
    generic: {
        english: [
            "{I'm currently reviewing your details, give me a quick minute.|Please hold on for a moment while I pull up your file.|I'm looking into this right now, I'll reply in just a minute.}",
            "{My system is running a bit slow, I'll be right with you with the exact details.|Just a moment, let me get the accurate information for you.|Give me just a second to verify this for you.}"
        ],
        hinglish: [
            "{Main ek minute aapki details check kar raha hoon, thoda time dijiye.|Aapke questions ka best solution dekh raha hoon, ek minute ruken.|Bas ek second dijiye, main check karke batata hoon.}",
            "{Network thoda slow hai, main abhi aapko exact details bhejta hoon.|Main personally isko abhi check kar raha hoon, please ek minute dijiye.|Aapko pura process samjhata hoon, bas ek minute dijiye.}"
        ],
        hindi: [
            "{मैं आपकी डिटेल्स चेक कर रहा हूं, कृपया एक मिनट का समय दें।|मैं अभी इस पर गौर कर रहा हूं, एक मिनट रुकें।}",
            "{नेटवर्क थोड़ा धीमा चल रहा है, मैं अभी आपको सही जानकारी भेजता हूं।|कृपया एक मिनट दें, मैं अभी चेक करके बताता हूं।}"
        ]
    },

    // ===== READY TO TRY =====
    ready_to_try: {
        english: [
            "{I am absolutely thrilled to hear that|That is fantastic news and exactly what I was hoping to hear|Excellent decision you are making a very smart move} {I guarantee you are going to be incredibly impressed with the results our new infrastructure delivers|I can confidently say that our premium traffic will exceed your expectations and deliver massive value} {We treat every test campaign with the utmost priority because we know the results will build a long-term partnership|My team and I will personally monitor your campaign to ensure you get the absolute best performance possible} {Please go ahead and place your order through the secure link: https://safetrafficpro.com/product/website-traffic/|You can securely set up your test campaign right here: https://safetrafficpro.com/product/website-traffic/} {Once you place the order let me know and I will make sure the 100K bonus is credited immediately|Just drop me a quick message after your purchase and I will manually expedite your campaign with the exclusive bonus}",
            "{This is a brilliant step forward for your business|I am so glad you decided to take this strategic step|You are making an excellent choice by testing our upgraded network} {I am personally committed to ensuring this test run proves our unparalleled quality to you|We let our analytics do the talking and I know you will be blown away by the traffic safety and engagement} {Our goal is to make you a permanent partner and this first campaign is where we prove our worth|I am confident that once you see the metrics you will never look for another traffic provider} {You can proceed with your preferred package here: https://safetrafficpro.com/product/website-traffic/|Please initiate your campaign using this direct link: https://safetrafficpro.com/product/website-traffic/} {I am standing by to process your order with the highest priority|I will be here to personally oversee your onboarding as soon as you are ready}"
        ],
        hinglish: [
            "{Ye jaankar mujhe bahut khushi hui|Ye ek fantastic decision hai aur mujhe poora yakeen tha aap yahi choose karenge|Aapne sach me ek bahut smart aur strategic step liya hai} {Main aapko guarantee deta hoon ki humare naye infrastructure ke results aapko completely impress kar denge|Main poore confidence ke saath keh sakta hoon ki humara premium traffic aapki expectations ko exceed karega} {Hum har test campaign ko highest priority par rakhte hain kyunki humein pata hai yahi se ek long-term partnership shuru hogi|Main personally aapke campaign ko monitor karunga taaki aapko absolute best performance mile} {Aap apna order is secure link ke through place kar sakte hain: https://safetrafficpro.com/product/website-traffic/|Aap apna test campaign yahan set up kar sakte hain: https://safetrafficpro.com/product/website-traffic/} {Jaise hi aap order place karein mujhe bata dijiyega main immediately apka 100K bonus credit karwa doonga|Purchase ke baad bas ek message drop kar dijiyega main aapka campaign fast-track karwa doonga}",
            "{Ye aapke business ke liye ek bahut brilliant step hai|Mujhe bahut khushi hai ki aapne ye strategic decision liya|Humare upgraded network ko test karna ek excellent choice hai} {Main personally committed hoon ye ensure karne ke liye ki ye test run aapko humari unparalleled quality prove kare|Humare analytics khud bolenge aur mujhe pata hai aap traffic ki safety dekh kar amaze ho jayenge} {Humara goal aapko ek permanent partner banana hai aur is pehle campaign se hum apni worth prove karenge|Mujhe yakeen hai jab aap metrics dekhenge toh aapko kisi aur provider ki zaroorat nahi padegi} {Aap apna preferred package yahan se proceed kar sakte hain: https://safetrafficpro.com/product/website-traffic/|Please is direct link ka use karke apna campaign initiate karein: https://safetrafficpro.com/product/website-traffic/} {Main highest priority ke saath aapka order process karne ke liye completely ready hoon|Jaise hi aap ready hon main aapki onboarding personally oversee karunga}"
        ],
        hindi: [
            "{यह जानकर मुझे बहुत खुशी हुई|यह एक शानदार निर्णय है और आपने बहुत समझदारी भरा कदम उठाया है} {मैं आपको गारंटी देता हूं कि हमारे नए नेटवर्क के परिणाम आपको पूरी तरह से प्रभावित करेंगे|मुझे पूरा विश्वास है कि हमारा प्रीमियम ट्रैफिक आपकी उम्मीदों से कहीं बेहतर साबित होगा} {हम हर टेस्ट कैंपेन को सर्वोच्च प्राथमिकता देते हैं क्योंकि हमें पता है कि यहीं से एक लंबी साझेदारी शुरू होगी} {आप अपना ऑर्डर इस सुरक्षित लिंक के माध्यम से दे सकते हैं: https://safetrafficpro.com/product/website-traffic/} {जैसे ही आप ऑर्डर करें मुझे बता दीजिएगा मैं तुरंत आपका 100K बोनस क्रेडिट करवा दूंगा}"
        ]
    }
};



// ==========================================
// MAIN AI BRAIN - INTENT DETECTION & REPLY
// ==========================================
async function autoReplyBrain(waService, phone, messageText, rawName, chatId = null) {
    const text = messageText.toLowerCase().trim();

    // Anti-Ban: Check if we already replied to this number recently (5 min cooldown)
    const lastReplyTime = replyCooldowns.get(phone);
    if (lastReplyTime && (Date.now() - lastReplyTime) < REPLY_COOLDOWN_MS) {
        console.log(`[AI Bot] Cooldown active for ${phone}. Skipping auto-reply to avoid suspicion.`);
        return;
    }
    
    // Attempt to find the lead to track conversation state
    let lead = await dbGet('SELECT * FROM leads WHERE phone = ?', [phone]);

    let stage = 0;
    let finalLangKey = null;
    
    // Detect current message language
    const currentLang = detectLanguage(messageText);
    const currentLangKey = (currentLang === 'hindi') ? 'hindi' : (currentLang === 'hinglish') ? 'hinglish' : 'english';

    if (lead) {
        stage = lead.bot_stage || 0;
        // Dynamic Language: Always use the language detected from their latest message
        finalLangKey = currentLangKey;
        if (lead.bot_lang !== finalLangKey) {
            await dbRun('UPDATE leads SET bot_lang = ? WHERE id = ?', [finalLangKey, lead.id]);
        }
    } else {
        finalLangKey = currentLangKey;
    }

    // If this lead already reached final stage (99), don't reply anymore
    if (stage >= 99) {
        console.log(`[AI Bot] Lead ${phone} has reached final stage. Not replying.`);
        return;
    }

    let intentKey = null;
    let newStage = stage;

    // --- INTENT DETECTION (ordered by priority) ---

    // 1. Abusive / Aggressive
    const abuseKeywords = ['fuck', 'scam', 'fraud', 'idiot', 'harass', 'madarchod', 'behenchod', 'chutiya', 'bakwas', 'bewakoof', 'pagal', 'gandu', 'sala', 'kamina', 'dhoka', 'dhokha', 'loot', 'chor', 'theif', 'thief'];
    if (abuseKeywords.some(kw => text.includes(kw))) {
        intentKey = 'abusive';
        newStage = 99;
    }
    // 2. Not Interested / Stop
    else if (text.includes('not interested') || text.includes('stop') || text.includes('unsubscribe') || text.includes('remove') || text.includes('nahi chahiye') || text.includes('nhi chahiye') || text.includes('interest nahi') || text.includes('rehne do') || text.includes('rehne de') || text.includes('mat karo') || text.includes('band karo') || text.includes('block')) {
        intentKey = 'not_interested';
        newStage = 99;
    }
    // 3. Ad Limit
    else if (text.includes('ad limit') || text.includes('ads limit') || text.includes('adlimit') || text.includes('limit lag')) {
        intentKey = 'ad_limit';
    }
    // 4. Complaint / Previous Order Issues (multi-stage)
    else if (text.includes('purana') || text.includes('pehle') || text.includes('old order') || text.includes('deliver nahi') || text.includes('deliver nhi') || text.includes('nahi mila') || text.includes('nhi mila') || text.includes('refund') || text.includes('return') || text.includes('pending') || text.includes('previous') || text.includes('pichla') || text.includes('wapas') || text.includes('vapas') || text.includes('payment') || text.includes('scam')) {
        if (stage <= 0) {
            intentKey = 'complaint_stage1';
            newStage = 1;
        } else if (stage === 1) {
            intentKey = 'complaint_stage2';
            newStage = 2;
        } else if (stage >= 2) {
            intentKey = 'complaint_stage3';
            newStage = 99;
        }
    }
    // 4. Who are you?
    else if (text.includes('who are') || text.includes('who is') || text.includes('kon hai') || text.includes('kaun hai') || text.includes('kaun ho') || text.includes('kon ho') || text.includes('don\'t know') || text.includes('kaise pata') || text.includes('number kahan') || text.includes('number kaha')) {
        intentKey = 'who_are_you';
    }
    // 5. Pricing
    else if (text.includes('price') || text.includes('cost') || text.includes('rate') || text.includes('how much') || text.includes('kitna') || text.includes('kitne') || text.includes('paisa') || text.includes('paise') || text.includes('charges') || text.includes('fee') || text.includes('budget')) {
        intentKey = 'pricing';
    }
    // 6. Ready to try
    else if (text.includes('try') || text.includes('test') || text.includes('karta hu') || text.includes('karte hai') || text.includes('dekhte') || text.includes('buy') || text.includes('purchase') || text.includes('link') || text.includes('bhejo') || text.includes('kaha se') || text.includes('start')) {
        intentKey = 'ready_to_try';
    }
    // 7. Generic message (Absolute Fallback so we NEVER ignore the user)
    else {
        intentKey = 'generic';
    }

    // Get conversation history for context
    let history = [];
    try {
        history = await Reply.find({ phone: '+' + phone }).sort({ created_at: -1 }).limit(6);
    } catch (e) {
        console.error('[AI Bot] Failed to fetch history', e);
    }

    let finalMessage = '';
    let usedLLM = false;

    try {
        // Attempt to get a response from the True AI (Gemini)
        finalMessage = await generateAIResponse(messageText, history, finalLangKey);
        usedLLM = true;
        console.log(`[AI Bot] Successfully generated LLM response for ${phone}`);
    } catch (llmError) {
        console.error(`[AI Bot] LLM failed, falling back to Spintax: ${llmError.message}`);
        
        // --- FALLBACK TO SPINTAX ENGINE ---
        const intentTemplates = RESPONSES[intentKey];
        if (!intentTemplates) return;
        
        const templateList = intentTemplates[finalLangKey] || intentTemplates['english'];
        if (!templateList || templateList.length === 0) return;

        let availableTemplates = templateList;
        if (lead && lead.last_template && templateList.length > 1) {
            availableTemplates = templateList.filter(t => t !== lead.last_template);
            if (availableTemplates.length === 0) availableTemplates = templateList; // Fallback just in case
        }
        const chosenTemplate = availableTemplates[Math.floor(Math.random() * availableTemplates.length)];
        
        finalMessage = parseSpintax(chosenTemplate);
        
        // Update lead state for spintax logic
        if (lead) {
            await Lead.updateOne({ _id: lead._id }, { bot_stage: newStage, bot_intent: intentKey, last_template: chosenTemplate });
        }
        
        // Enforce strict character stripping for fallback
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = [];
        finalMessage = finalMessage.replace(urlRegex, (match) => {
            urls.push(match);
            return `__URL_${urls.length - 1}__`;
        });
        
        finalMessage = finalMessage.replace(/[^\p{L}\p{M}\p{N}\s_]/gu, '');

        urls.forEach((url, i) => {
            finalMessage = finalMessage.replace(`__URL_${i}__`, url);
        });
    }

    // --- HUMAN SIMULATION ---
    const readDelay = Math.floor(Math.random() * (5000 - 2000 + 1) + 2000);
    console.log(`[AI Bot] Detected: lang=${finalLangKey}, intent=${usedLLM ? 'LLM' : intentKey}, stage=${stage}->${newStage}. Replying in ${readDelay}ms...`);
    
    setTimeout(async () => {
        try {
            await waService.client.sendPresenceAvailable();
            
            let targetId = chatId;
            if (!targetId) {
                const contactId = await waService.client.getNumberId(phone);
                targetId = contactId ? contactId._serialized : (phone.includes('@') ? phone : `${phone}@c.us`);
            }
            const typingDuration = Math.min(finalMessage.length * 40, 6000); // Max 6 sec typing
            
            const chat = await waService.client.getChatById(targetId);
            await chat.sendStateTyping();
            
            // Human Typing Cadence (Type -> Pause -> Type)
            const typeTime1 = Math.min(finalMessage.length * 20, 5000); // Max 5s initial typing
            await new Promise(resolve => setTimeout(resolve, typeTime1));
            
            // 60% chance to pause (simulating thinking/correcting typo)
            if (Math.random() > 0.4 && finalMessage.length > 20) {
                await chat.clearState(); // Pause typing
                const pauseTime = Math.floor(Math.random() * (3000 - 1000 + 1)) + 1000;
                await new Promise(resolve => setTimeout(resolve, pauseTime));
                
                await chat.sendStateTyping(); // Resume typing
                const typeTime2 = Math.min(finalMessage.length * 15, 4000); // Max 4s final typing
                await new Promise(resolve => setTimeout(resolve, typeTime2));
            }
            
            await waService.client.sendMessage(targetId, finalMessage);
            await chat.clearState();

            console.log(`[AI Bot] Replied to ${phone} (${finalLangKey}/${intentKey})`);

            // Set cooldown for this number
            replyCooldowns.set(phone, Date.now());

            // Anti-Ban: Randomly go offline after replying (70% chance)
            if (Math.random() > 0.3) {
                await waService.client.sendPresenceUnavailable();
            }
            
            // Save bot's reply in the replies table (with 🤖 prefix so the user knows what the bot said)
            await Reply.create({
                name: '🤖 Bot Reply',
                phone: '+' + phone,
                message: '↪ Replied to ' + (rawName || 'Client') + ':\n\n' + finalMessage
            });
        } catch (err) {
            console.error('[AI Bot] Failed to send auto-reply:', err.message);
        }
    }, readDelay);
}

module.exports = {
    autoReplyBrain
};
