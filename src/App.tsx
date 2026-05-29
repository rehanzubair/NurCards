import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  addDoc, 
  getDoc, 
  doc, 
  serverTimestamp, 
  onSnapshot,
  query,
  where,
  orderBy,
  getDocFromServer,
  updateDoc,
  deleteDoc,
  setDoc
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { GoogleGenAI } from "@google/genai";
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Share2, 
  Image as ImageIcon, 
  Loader2, 
  LogOut, 
  LogIn, 
  BookOpen, 
  ChevronRight,
  ArrowLeft,
  Copy,
  Check,
  AlertTriangle,
  Send,
  RotateCw,
  MessageSquare,
  Trash2,
  Edit,
  Save,
  X,
  Sparkles,
  Settings,
  Menu,
  Layout
} from 'lucide-react';
import { db, auth, login, logout } from './lib/firebase';
import { cn } from './lib/utils';

// --- Constants ---
const ADMIN_EMAIL = 'bluqrguy@gmail.com';

// --- Types ---
interface Flashcard {
  id: string;
  title: string;
  topic: string;
  description?: string;
  imageUrl?: string;
  aiResponse: string;
  authorId: string;
  boardId: string;
  createdAt: any;
}

interface Board {
  id: string;
  name: string;
  description?: string;
  authorId: string;
  createdAt: any;
}

interface UserProfile {
  globalBackImageUrl?: string;
  defaultBoardName?: string;
  defaultBoardDescription?: string;
  updatedAt?: any;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: any[];
  }
}

// --- Helpers ---
const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
};

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setHasError(true);
      try {
        const parsed = JSON.parse(event.error.message);
        setErrorMsg(parsed.error || 'An unexpected error occurred.');
      } catch {
        setErrorMsg(event.error.message || 'An unexpected error occurred.');
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    const isQuotaError = errorMsg.toLowerCase().includes('quota exceeded');
    
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-950 p-4">
        <div className="bg-stone-900 p-8 rounded-[2rem] shadow-2xl max-w-md w-full border border-stone-800 text-center">
          <div className="w-16 h-16 bg-stone-800 rounded-2xl flex items-center justify-center text-stone-400 mx-auto mb-6">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-serif text-stone-100 mb-4">
            {isQuotaError ? 'Daily Limit Reached' : 'Something went wrong'}
          </h2>
          <p className="text-stone-400 mb-8 leading-relaxed">
            {isQuotaError 
              ? "The application has reached its free tier limit for today. This usually resets every 24 hours. Please try again tomorrow."
              : errorMsg}
          </p>
          <div className="space-y-3">
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-stone-100 text-stone-900 rounded-full font-medium hover:bg-white transition-all shadow-lg active:scale-95"
            >
              Try Reloading
            </button>
            {isQuotaError && (
              <p className="text-xs text-stone-600 pt-4">
                Free tier limits: 50k reads, 20k writes per day.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState<'home' | 'create' | 'view' | 'dashboard'>('home');
  const [selectedCard, setSelectedCard] = useState<Flashcard | null>(null);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);

  // Sync selected card with updated data from cards array
  useEffect(() => {
    if (selectedCard) {
      const updatedCard = cards.find(c => c.id === selectedCard.id);
      if (updatedCard && (
        updatedCard.title !== selectedCard.title ||
        updatedCard.topic !== selectedCard.topic ||
        updatedCard.description !== selectedCard.description ||
        updatedCard.imageUrl !== selectedCard.imageUrl ||
        updatedCard.aiResponse !== selectedCard.aiResponse
      )) {
        setSelectedCard(updatedCard);
      }
    }
  }, [cards, selectedCard?.id]);
  const [loading, setLoading] = useState(false);
  const [currentBoard, setCurrentBoard] = useState<Board | null>(null);
  const [currentBoardId, setCurrentBoardId] = useState<string | null>(null);
  const [sharedCardId, setSharedCardId] = useState<string | null>(null);
  const [isBoardView, setIsBoardView] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [copiedBoard, setCopiedBoard] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isAdmin = user?.email === ADMIN_EMAIL;

  // Check for shared card or board view in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cardId = params.get('card');
    const board = params.get('view') === 'board';
    const boardId = params.get('board');
    
    if (cardId) {
      setSharedCardId(cardId);
      loadSharedCard(cardId);
    }
    
    if (board) {
      setIsBoardView(true);
      if (!boardId) {
        setCurrentBoardId('default');
      }
    }

    if (boardId) {
      setCurrentBoardId(boardId);
      setIsBoardView(true);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      
      // If admin and no board/card in URL, default to dashboard
      const params = new URLSearchParams(window.location.search);
      if (u?.email === ADMIN_EMAIL && !params.get('board') && !params.get('card')) {
        setView('dashboard');
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (doc) => {
      if (doc.exists()) {
        setUserProfile(doc.data() as UserProfile);
      }
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!selectedCard?.authorId) {
      setAuthorProfile(null);
      return;
    }
    const unsubscribe = onSnapshot(doc(db, 'users', selectedCard.authorId), (doc) => {
      if (doc.exists()) {
        setAuthorProfile(doc.data() as UserProfile);
      } else {
        setAuthorProfile(null);
      }
    });
    return () => unsubscribe();
  }, [selectedCard?.authorId]);

  useEffect(() => {
    if (!currentBoardId || currentBoardId === 'default') {
      setCurrentBoard(null);
      return;
    }
    
    const unsubscribe = onSnapshot(doc(db, 'boards', currentBoardId), (doc) => {
      if (doc.exists()) {
        setCurrentBoard({ id: doc.id, ...doc.data() } as Board);
      } else {
        setCurrentBoard(null);
      }
    });
    return () => unsubscribe();
  }, [currentBoardId]);

  useEffect(() => {
    // If we have a board, fetch its author's profile
    const authorId = currentBoard?.authorId;
    if (!authorId) return;
    
    const unsubscribe = onSnapshot(doc(db, 'users', authorId), (doc) => {
      if (doc.exists()) {
        setAuthorProfile(doc.data() as UserProfile);
      }
    });
    return () => unsubscribe();
  }, [currentBoard?.authorId]);

  useEffect(() => {
    // If it's the default board, we need to find the admin's profile
    // Since we don't have the admin UID, we'll fetch it from the first card's author
    if (currentBoardId !== 'default' && (currentBoardId || !isBoardView)) return;
    if (cards.length === 0) return;
    
    const adminUid = cards[0].authorId;
    if (!adminUid) return;
    
    const unsubscribe = onSnapshot(doc(db, 'users', adminUid), (doc) => {
      if (doc.exists()) {
        setAuthorProfile(doc.data() as UserProfile);
      }
    });
    return () => unsubscribe();
  }, [currentBoardId, isBoardView, cards.length > 0]);

  useEffect(() => {
    if (!isAuthReady) return;
    
    // Fetch cards if admin OR if we are in board view
    if (!isAdmin && !isBoardView) return;

    setLoading(true);

    // Public board and admin view both see all cards
    // We filter by boardId in memory to avoid composite index requirements
    const q = query(
      collection(db, 'flashcards'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let fetchedCards = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Flashcard[];

      if (currentBoardId) {
        fetchedCards = fetchedCards.filter(card => {
          // If a card has no boardId, it belongs to the 'default' board
          const cardBoardId = card.boardId || 'default';
          return cardBoardId === currentBoardId;
        });
      } else if (isBoardView && !isAdmin) {
        // If it's a public board view but no boardId is specified, 
        // we might want to show nothing or all cards. 
        // Usually, a shared board link will have ?board=ID
      }

      setCards(fetchedCards);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'flashcards');
    });

    return () => unsubscribe();
  }, [user, isAuthReady, isBoardView, isAdmin, currentBoardId]);

  useEffect(() => {
    if (!isAdmin) return;
    
    const q = query(collection(db, 'boards'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedBoards = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Board[];
      setBoards(fetchedBoards);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'boards');
    });
    
    return () => unsubscribe();
  }, [isAdmin]);

  const loadSharedCard = async (id: string) => {
    setLoading(true);
    try {
      const docRef = doc(db, 'flashcards', id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setSelectedCard({ id: docSnap.id, ...docSnap.data() } as Flashcard);
        setView('view');
      } else {
        console.error("No such card!");
        setView('home');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `flashcards/${id}`);
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error) {
      if(error instanceof Error && error.message.includes('the client is offline')) {
        console.error("Please check your Firebase configuration.");
      }
    }
  };

  useEffect(() => {
    testConnection();
  }, []);

  const handleShareBoard = () => {
    let baseUrl = (window as any).__PUBLIC_SHARE_URL__ || window.location.origin;
    if (baseUrl.includes("-dev-")) {
      baseUrl = baseUrl.replace("-dev-", "-pre-");
    }
    const boardId = currentBoardId || 'default';
    const boardUrl = `${baseUrl}/sb/${boardId}`;
    navigator.clipboard.writeText(boardUrl);
    setCopiedBoard(true);
    setTimeout(() => setCopiedBoard(false), 2000);
  };

  // Scroll to top when view changes
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#fbfbfd] text-stone-900 font-sans selection:bg-stone-200 selection:text-stone-900">
        {/* Subtle Background Pattern */}
        <div className="fixed inset-0 z-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: `radial-gradient(#000 1px, transparent 1px)`, backgroundSize: '40px 40px' }} />
        
        {/* Burger Menu Button */}
        <button 
          onClick={() => setIsMenuOpen(true)}
          className="fixed top-6 left-6 z-[60] p-3 bg-white/80 backdrop-blur-xl border border-stone-200/40 rounded-2xl shadow-sm hover:bg-white transition-all text-stone-600 group"
        >
          <Menu className="w-6 h-6 group-hover:scale-110 transition-transform" />
        </button>

        {/* Collapsible Sidebar */}
        <AnimatePresence>
          {isMenuOpen && (
            <>
              {/* Backdrop */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMenuOpen(false)}
                className="fixed inset-0 z-[70] bg-stone-900/20 backdrop-blur-sm"
              />
              
              {/* Sidebar */}
              <motion.div 
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-0 left-0 bottom-0 w-80 z-[80] bg-white shadow-2xl border-r border-stone-200/40 p-8 flex flex-col"
              >
                <div className="flex justify-between items-center mb-12">
                  <div 
                    className="flex items-center gap-2 cursor-pointer group"
                    onClick={() => {
                      if (isAdmin) {
                        setView('dashboard');
                        setCurrentBoardId(null);
                        window.history.pushState({}, '', '/');
                      } else {
                        setView('home');
                        window.history.pushState({}, '', '/?view=board');
                        setIsBoardView(true);
                      }
                      setSharedCardId(null);
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="w-10 h-10 bg-stone-800 rounded-xl flex items-center justify-center text-stone-50 group-hover:scale-105 transition-transform">
                      <BookOpen className="w-6 h-6" />
                    </div>
                    <h1 className="text-xl font-serif font-semibold tracking-tight">Nur Flashcards</h1>
                  </div>
                  <button 
                    onClick={() => setIsMenuOpen(false)}
                    className="p-2 hover:bg-stone-100 rounded-full transition-colors text-stone-400"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 space-y-6">
                  {user ? (
                    <div className="space-y-6">
                      <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                        <p className="text-xs text-stone-400 uppercase tracking-widest font-bold mb-1">Logged in as</p>
                        <p className="text-stone-800 font-medium truncate">{user.displayName || user.email}</p>
                        {!isAdmin && (
                          <span className="text-[10px] text-red-400 font-bold uppercase tracking-tighter mt-1 block">
                            Not Admin
                          </span>
                        )}
                      </div>

                      <div className="space-y-2">
                        {isAdmin && (
                          <>
                            <button 
                              onClick={() => {
                                setView('dashboard');
                                setIsMenuOpen(false);
                              }}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-stone-50 rounded-xl transition-all text-stone-600 text-sm font-medium border border-transparent hover:border-stone-100"
                            >
                              <Layout className="w-5 h-5" />
                              Manage Boards
                            </button>
                            <button 
                              onClick={() => {
                                handleShareBoard();
                                setIsMenuOpen(false);
                              }}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-stone-50 rounded-xl transition-all text-stone-600 text-sm font-medium border border-transparent hover:border-stone-100"
                            >
                              {copiedBoard ? <Check className="w-5 h-5 text-green-500" /> : <Share2 className="w-5 h-5" />}
                              {copiedBoard ? 'Link Copied' : 'Share Public Board'}
                            </button>
                            <button 
                              onClick={() => {
                                setIsSettingsOpen(true);
                                setIsMenuOpen(false);
                              }}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-stone-50 rounded-xl transition-all text-stone-600 text-sm font-medium border border-transparent hover:border-stone-100"
                            >
                              <Settings className="w-5 h-5" />
                              Global Settings
                            </button>
                          </>
                        )}
                        <button 
                          onClick={() => {
                            logout();
                            setIsMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-50 text-stone-600 hover:text-red-600 rounded-xl transition-all text-sm font-medium border border-transparent hover:border-red-100"
                        >
                          <LogOut className="w-5 h-5" />
                          Logout
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-sm text-stone-500 font-light leading-relaxed">
                        Login as an administrator to manage cards and settings.
                      </p>
                      <button 
                        onClick={() => {
                          login();
                          setIsMenuOpen(false);
                        }}
                        className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-stone-800 text-stone-50 rounded-xl text-sm font-medium hover:bg-stone-700 transition-all shadow-sm"
                      >
                        <LogIn className="w-4 h-4" />
                        Admin Login
                      </button>
                    </div>
                  )}
                </div>

                <div className="pt-8 border-t border-stone-100">
                  <p className="text-[10px] text-stone-400 uppercase tracking-[0.2em] font-bold">
                    Nur Flashcards v1.0
                  </p>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <main className="max-w-7xl mx-auto px-6 pt-8 pb-24">
          <AnimatePresence mode="wait">
            {view === 'home' && (
              <motion.div 
                key="home"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-12"
              >
                {(isAdmin || isBoardView) ? (
                  <>
                    <div className="relative flex flex-col items-center justify-center mb-12">
                      {isAdmin && currentBoardId && (
                        <button 
                          onClick={() => {
                            setCurrentBoardId(null);
                            setView('dashboard');
                          }}
                          className="absolute -top-12 left-0 flex items-center gap-2 text-stone-400 hover:text-stone-600 transition-colors text-sm font-medium"
                        >
                          <ArrowLeft className="w-4 h-4" />
                          Back to Dashboard
                        </button>
                      )}
                      <div className="text-center space-y-2">
                        <h2 className="text-4xl sm:text-5xl font-serif font-light text-stone-800 tracking-tight">
                          {currentBoardId && currentBoardId !== 'default' 
                            ? (currentBoard?.name || 'Wisdom Board') 
                            : (authorProfile?.defaultBoardName || userProfile?.defaultBoardName || 'Wisdom Board')}
                        </h2>
                        <p className="text-stone-500 max-w-xl mx-auto text-base font-light">
                          {currentBoardId && currentBoardId !== 'default' 
                            ? (currentBoard?.description || 'A curated collection of reflections and insights.') 
                            : (authorProfile?.defaultBoardDescription || userProfile?.defaultBoardDescription || 'A curated collection of reflections and insights.')}
                        </p>
                      </div>

                      <div className="sm:absolute sm:top-0 sm:right-0 flex items-center gap-3 mt-6 sm:mt-0">
                        {isAdmin && (
                          <button 
                            onClick={() => {
                              if (!currentBoardId && boards.length > 0) {
                                // If no board selected, maybe show dashboard first?
                                // For now, we'll allow creating if a board is selected or if we handle it in the form
                                setView('create');
                              } else if (!currentBoardId && boards.length === 0) {
                                // No boards at all
                                setView('dashboard');
                              } else {
                                setView('create');
                              }
                            }}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-stone-900 text-stone-50 rounded-full text-sm font-medium hover:bg-stone-800 transition-all shadow-md hover:shadow-lg active:scale-95 group"
                          >
                            <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform" />
                            <span className="hidden md:inline">Create New Card</span>
                            <span className="md:hidden">New</span>
                          </button>
                        )}
                        <button 
                          onClick={handleShareBoard}
                          className="inline-flex items-center gap-2 px-6 py-3 bg-white text-stone-900 border border-stone-200 rounded-full text-sm font-medium hover:bg-stone-50 transition-all shadow-sm hover:shadow-md active:scale-95 group"
                        >
                          {copiedBoard ? <Check className="w-4 h-4 text-green-600" /> : <Share2 className="w-4 h-4 group-hover:scale-110 transition-transform" />}
                          {copiedBoard ? 'Link Copied' : 'Share Board'}
                        </button>
                      </div>
                    </div>

                    {cards.length > 0 && (
                      <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-6">
                        {cards.map((card) => (
                          <div key={card.id} className="break-inside-avoid mb-6">
                            <CardPreview 
                              card={card} 
                              onClick={() => {
                                setSelectedCard(card);
                                setView('view');
                                window.history.pushState({}, '', `?card=${card.id}${isBoardView ? '&view=board' : ''}`);
                              }} 
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {cards.length === 0 && !loading && (
                      <div className="bg-stone-100 rounded-[3rem] p-20 text-center border border-stone-200/50">
                        <p className="text-stone-500 italic text-xl">
                          {isAdmin 
                            ? "Your mood board is empty. Begin your journey by creating a card."
                            : "No wisdom cards found on the board."}
                        </p>
                      </div>
                    )}

                    {loading && (
                      <div className="py-32 flex flex-col items-center justify-center space-y-6">
                        <div className="relative w-10 h-10">
                          {[...Array(12)].map((_, i) => (
                            <div
                              key={i}
                              className="absolute left-1/2 top-0 h-2.5 w-0.5 origin-[0_20px] rounded-full bg-stone-400 animate-ios-spinner"
                              style={{
                                transform: `translateX(-50%) rotate(${i * 30}deg)`,
                                animationDelay: `${-1.1 + i * 0.1}s`
                              }}
                            />
                          ))}
                        </div>
                        <p className="text-stone-400 text-sm font-medium tracking-wide animate-pulse">Loading Wisdom...</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center space-y-8 py-20">
                    <div className="w-20 h-20 bg-stone-100 rounded-3xl flex items-center justify-center text-stone-300 mx-auto mb-6">
                      <BookOpen className="w-10 h-10" />
                    </div>
                    <h2 className="text-4xl sm:text-5xl font-serif font-light text-stone-800">
                      Nur Flashcards
                    </h2>
                    <p className="text-stone-500 max-w-md mx-auto text-lg leading-relaxed">
                      A collection of wisdom and reflections from the Quran and Hadith, shared through AI-powered flashcards.
                    </p>
                    <div className="pt-8 space-y-6">
                      <button 
                        onClick={() => {
                          setIsBoardView(true);
                          window.history.pushState({}, '', '/?view=board');
                        }}
                        className="inline-flex items-center gap-2 text-stone-900 font-medium hover:gap-4 transition-all group"
                      >
                        Explore Public Board
                        <ChevronRight className="w-5 h-5" />
                      </button>
                      <p className="text-stone-400 text-sm italic">
                        Or use a direct link shared by the admin to view a specific card.
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}


            {view === 'dashboard' && isAdmin && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <Dashboard 
                  boards={boards}
                  currentBoardId={currentBoardId}
                  defaultBoardInfo={{
                    name: userProfile?.defaultBoardName || 'Wisdom Board',
                    description: userProfile?.defaultBoardDescription || 'Your original collection of curated reflections and insights.'
                  }}
                  onSelectBoard={(id) => {
                    setCurrentBoardId(id);
                    setView('home');
                    window.history.pushState({}, '', `/?board=${id}`);
                  }}
                  onCreateBoard={async (name, description) => {
                    try {
                      const boardData = {
                        name,
                        description,
                        authorId: auth.currentUser!.uid,
                        createdAt: serverTimestamp()
                      };
                      await addDoc(collection(db, 'boards'), boardData);
                    } catch (error) {
                      handleFirestoreError(error, OperationType.WRITE, 'boards');
                    }
                  }}
                  onUpdateBoard={async (id, name, description) => {
                    try {
                      if (id === 'default') {
                        const profileData = {
                          ...userProfile,
                          defaultBoardName: name,
                          defaultBoardDescription: description,
                          updatedAt: serverTimestamp()
                        };
                        await setDoc(doc(db, 'users', auth.currentUser!.uid), profileData, { merge: true });
                        setUserProfile(profileData as any);
                      } else {
                        await updateDoc(doc(db, 'boards', id), {
                          name,
                          description,
                          updatedAt: serverTimestamp()
                        });
                      }
                    } catch (error) {
                      handleFirestoreError(error, OperationType.UPDATE, id === 'default' ? 'users' : 'boards');
                    }
                  }}
                  onDeleteBoard={async (id) => {
                    try {
                      await deleteDoc(doc(db, 'boards', id));
                      if (currentBoardId === id) {
                        setCurrentBoardId(null);
                        setView('dashboard');
                      }
                    } catch (error) {
                      handleFirestoreError(error, OperationType.DELETE, 'boards');
                    }
                  }}
                />
              </motion.div>
            )}

            {view === 'create' && (
              <motion.div 
                key="create"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="max-w-2xl mx-auto"
              >
                <CreateCardForm 
                  currentBoardId={currentBoardId}
                  onCancel={() => setView('home')} 
                  onSuccess={(card) => {
                    setSelectedCard(card);
                    setView('view');
                    window.history.pushState({}, '', `?card=${card.id}${currentBoardId ? `&board=${currentBoardId}` : ''}`);
                  }}
                />
              </motion.div>
            )}

            {view === 'view' && selectedCard && (
              <motion.div 
                key="view"
                layoutId={`card-${selectedCard.id}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.4, type: "spring", stiffness: 100, damping: 20 }}
                className="max-w-5xl mx-auto w-full"
              >
                <CardDetail 
                  card={selectedCard} 
                  onBack={() => {
                    if (sharedCardId) {
                      setSharedCardId(null);
                      setIsBoardView(true);
                      setView('home');
                      window.history.pushState({}, '', '/?view=board');
                    } else {
                      setView('home');
                      window.history.pushState({}, '', isBoardView ? '/?view=board' : '/');
                    }
                  }} 
                  isGuestView={!isAdmin}
                  globalBackImageUrl={authorProfile?.globalBackImageUrl}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
        {isSettingsOpen && (
          <SettingsModal 
            onClose={() => setIsSettingsOpen(false)}
            currentProfile={userProfile}
            onUpdate={(profile) => setUserProfile(profile)}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}

// --- Sub-components ---

function CardPreview({ card, onClick }: { card: Flashcard, onClick: () => void }) {
  return (
    <motion.div 
      layoutId={`card-${card.id}`}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="relative bg-white rounded-3xl overflow-hidden shadow-sm hover:shadow-xl border border-stone-200/60 cursor-pointer transition-all duration-300 group flex flex-col"
    >
      {card.imageUrl && (
        <div className="relative w-full overflow-hidden bg-stone-100">
          <img 
            src={card.imageUrl} 
            alt={card.title} 
            className="w-full h-auto object-cover group-hover:scale-105 transition-transform duration-700 ease-out block"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
        </div>
      )}
      
      <div className="p-5 space-y-2">
        {!card.imageUrl && (
          <div className="w-10 h-10 bg-stone-100 rounded-2xl flex items-center justify-center text-stone-400 mb-4 group-hover:bg-stone-800 group-hover:text-stone-50 transition-all duration-500">
            <BookOpen className="w-5 h-5" />
          </div>
        )}
        <h3 className="text-lg font-serif font-semibold text-stone-800 leading-tight group-hover:text-stone-600 transition-colors">
          {card.title}
        </h3>
        <p className="text-stone-500 text-xs line-clamp-2 font-light leading-relaxed">
          {card.description || card.topic}
        </p>
        <div className="flex items-center text-stone-400 text-[10px] font-medium uppercase tracking-widest pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <span>Discover</span>
          <ChevronRight className="w-3 h-3 ml-1 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </motion.div>
  );
}

function Dashboard({ 
  boards, 
  onSelectBoard, 
  onCreateBoard,
  onUpdateBoard,
  onDeleteBoard,
  currentBoardId,
  defaultBoardInfo
}: { 
  boards: Board[], 
  onSelectBoard: (id: string) => void, 
  onCreateBoard: (name: string, description: string) => void,
  onUpdateBoard: (id: string, name: string, description: string) => void,
  onDeleteBoard: (id: string) => void,
  currentBoardId: string | null,
  defaultBoardInfo: { name: string, description: string }
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingBoard, setEditingBoard] = useState<{ id: string, name: string, description?: string } | null>(null);
  const [boardToDelete, setBoardToDelete] = useState<{ id: string, name: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onCreateBoard(newName, newDesc);
    setNewName('');
    setNewDesc('');
    setIsCreating(false);
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBoard || !newName.trim()) return;
    onUpdateBoard(editingBoard.id, newName, newDesc);
    setNewName('');
    setNewDesc('');
    setEditingBoard(null);
  };

  const startEditing = (e: React.MouseEvent, board: { id: string, name: string, description?: string }) => {
    e.stopPropagation();
    setEditingBoard(board);
    setNewName(board.name);
    setNewDesc(board.description || '');
  };

  return (
    <div className="space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <h2 className="text-4xl sm:text-5xl font-serif font-light text-stone-800 tracking-tight">
            Your Boards
          </h2>
          <p className="text-stone-500 text-lg font-light">
            Manage your collections of wisdom and insights.
          </p>
        </div>
        <button 
          onClick={() => setIsCreating(true)}
          className="inline-flex items-center gap-2 px-8 py-4 bg-stone-900 text-stone-50 rounded-full font-medium hover:bg-stone-800 transition-all shadow-xl active:scale-95"
        >
          <Plus className="w-5 h-5" />
          Create New Board
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {/* Virtual Wisdom Board for legacy cards */}
        <motion.div 
          whileHover={{ y: -5 }}
          className={cn(
            "group relative bg-white rounded-[2.5rem] p-8 border transition-all cursor-pointer",
            currentBoardId === 'default' || (!currentBoardId && boards.length === 0) ? "border-stone-800 ring-1 ring-stone-800 shadow-xl" : "border-stone-100 hover:border-stone-200 shadow-sm hover:shadow-md"
          )}
          onClick={() => onSelectBoard('default')}
        >
          <div className="space-y-4">
            <div className="flex justify-between items-start">
              <div className="w-12 h-12 bg-stone-50 rounded-2xl flex items-center justify-center text-stone-400 group-hover:bg-stone-100 transition-colors">
                <Sparkles className="w-6 h-6" />
              </div>
              <button 
                onClick={(e) => startEditing(e, { id: 'default', name: defaultBoardInfo.name, description: defaultBoardInfo.description })}
                className="p-2 hover:bg-stone-100 rounded-full transition-colors text-stone-400 hover:text-stone-800"
                title="Edit Board"
              >
                <Edit className="w-4 h-4" />
              </button>
            </div>
            <div>
              <h3 className="text-xl font-serif font-bold text-stone-800 group-hover:text-stone-600 transition-colors">
                {defaultBoardInfo.name}
              </h3>
              <p className="text-stone-500 text-sm line-clamp-2 font-light leading-relaxed mt-2">
                {defaultBoardInfo.description}
              </p>
            </div>
            <div className="pt-4 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-stone-400">
              <span>Default Board</span>
              <div className="flex items-center gap-1 text-stone-800 opacity-0 group-hover:opacity-100 transition-opacity">
                <span>Open Board</span>
                <ChevronRight className="w-3 h-3" />
              </div>
            </div>
          </div>
        </motion.div>

        {boards.map(board => (
          <motion.div 
            key={board.id}
            whileHover={{ y: -5 }}
            className={cn(
              "group relative bg-white rounded-[2.5rem] p-8 border transition-all cursor-pointer",
              currentBoardId === board.id ? "border-stone-800 ring-1 ring-stone-800 shadow-xl" : "border-stone-100 hover:border-stone-200 shadow-sm hover:shadow-md"
            )}
            onClick={() => onSelectBoard(board.id)}
          >
            <div className="space-y-4">
              <div className="flex justify-between items-start">
                <div className="w-12 h-12 bg-stone-50 rounded-2xl flex items-center justify-center text-stone-400 group-hover:bg-stone-100 transition-colors">
                  <Layout className="w-6 h-6" />
                </div>
                <button 
                  onClick={(e) => startEditing(e, board)}
                  className="p-2 hover:bg-stone-100 rounded-full transition-colors text-stone-400 hover:text-stone-800"
                  title="Edit Board"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setBoardToDelete({ id: board.id, name: board.name });
                  }}
                  className="p-2 hover:bg-red-50 rounded-full transition-colors text-stone-400 hover:text-red-600"
                  title="Delete Board"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div>
                <h3 className="text-xl font-serif font-bold text-stone-800 group-hover:text-stone-600 transition-colors">
                  {board.name}
                </h3>
                <p className="text-stone-500 text-sm line-clamp-2 font-light leading-relaxed mt-2">
                  {board.description || "No description provided."}
                </p>
              </div>
              <div className="pt-4 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-stone-400">
                <span>{board.createdAt?.seconds ? new Date(board.createdAt.seconds * 1000).toLocaleDateString() : 'Just now'}</span>
                <div className="flex items-center gap-1 text-stone-800 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span>Open Board</span>
                  <ChevronRight className="w-3 h-3" />
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {(isCreating || editingBoard) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-stone-900/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-[2rem] p-8 max-w-md w-full shadow-2xl border border-stone-200"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-serif font-bold text-stone-800">
                {isCreating ? 'New Board' : 'Edit Board'}
              </h2>
              <button 
                onClick={() => {
                  setIsCreating(false);
                  setEditingBoard(null);
                }} 
                className="p-2 hover:bg-stone-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-stone-500" />
              </button>
            </div>
            <form onSubmit={isCreating ? handleCreate : handleUpdate} className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-stone-400">Board Name</label>
                <input 
                  type="text" 
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Ramadan Reflections"
                  className="w-full bg-stone-50 border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-stone-200 transition-all text-lg"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-stone-400">Description</label>
                <textarea 
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="What is this board about?"
                  className="w-full bg-stone-50 border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-stone-200 transition-all min-h-[100px] text-lg resize-none"
                />
              </div>
              <button 
                type="submit"
                className="w-full py-4 bg-stone-800 text-white rounded-full font-medium hover:bg-stone-700 transition-all shadow-lg"
              >
                {isCreating ? 'Create Board' : 'Save Changes'}
              </button>
            </form>
          </motion.div>
        </div>
      )}

      {boardToDelete && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-stone-900/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-[2rem] p-8 max-w-md w-full shadow-2xl border border-stone-200 text-center"
          >
            <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-red-500 mx-auto mb-6">
              <Trash2 className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-serif font-bold text-stone-800 mb-2">Delete Board?</h2>
            <p className="text-stone-500 mb-8">
              Are you sure you want to delete <span className="font-bold text-stone-800">"{boardToDelete.name}"</span>? 
              This action cannot be undone.
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => setBoardToDelete(null)}
                className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-full font-medium hover:bg-stone-200 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={async () => {
                  setIsDeleting(true);
                  await onDeleteBoard(boardToDelete.id);
                  setIsDeleting(false);
                  setBoardToDelete(null);
                }}
                disabled={isDeleting}
                className="flex-1 py-4 bg-red-600 text-white rounded-full font-medium hover:bg-red-700 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeleting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Delete'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function CreateCardForm({ onCancel, onSuccess, currentBoardId }: { onCancel: () => void, onSuccess: (card: Flashcard) => void, currentBoardId: string | null }) {
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const generateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !topic || loading) return;

    setLoading(true);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("Gemini API key is missing. Please check your environment configuration.");
      }

      const ai = new GoogleGenAI({ apiKey });
      
      // Use gemini-3-flash-preview for better reasoning and reliability
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are a wise narrator. Provide a concise, gentle, and insightful explanation of the key concepts, references, and stories in the Quran and Hadith on the topic: "${topic}". 

Rules for your response:
1. Use a wise and patient tone.
2. do NOT address the reader directly (avoid phrases like "My dear child", "Listen closely", or "I hope you find this helpful"). 
3. Focus strictly on the wisdom and knowledge itself.
4. Whenever you reference or quote from the Quran or Hadith, you MUST:
   - Provide the original Arabic text wrapped in an HTML div with the class "arabic-text" (e.g., <div class="arabic-text">...</div>).
   - Provide the English translation.
   - Provide the specific reference number (e.g., Surah Name/Number:Ayah Number for Quran, or the specific collection and Hadith number for Hadith).
5. Use Markdown for formatting.`,
      });

      if (!response.text) {
        const finishReason = response.candidates?.[0]?.finishReason;
        console.error("AI Response was empty or blocked. Finish reason:", finishReason);
        throw new Error(`The wisdom could not be found for this topic (Reason: ${finishReason || 'Unknown'}). Please try a different or more specific topic.`);
      }

      const aiResponse = response.text;

      const cardData = {
        title,
        topic,
        description: description || null,
        imageUrl: image || null,
        aiResponse,
        authorId: auth.currentUser!.uid,
        boardId: currentBoardId || 'default',
        createdAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, 'flashcards'), cardData);
      
      onSuccess({
        id: docRef.id,
        ...cardData,
        createdAt: new Date() // Temporary client-side date
      } as Flashcard);

    } catch (error) {
      console.error("Generation Error:", error);
      // Distinguish between AI errors and Firestore errors
      if (error instanceof Error && (error.message.includes("Gemini") || error.message.includes("wisdom"))) {
        throw error; // Let ErrorBoundary handle it with the specific message
      }
      handleFirestoreError(error, OperationType.WRITE, 'flashcards');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-[2rem] p-8 sm:p-12 shadow-xl border border-stone-200">
      <div className="flex items-center gap-4 mb-8">
        <button 
          onClick={onCancel}
          className="p-2 hover:bg-stone-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-stone-500" />
        </button>
        <h2 className="text-2xl font-serif font-semibold text-stone-800">Create New Wisdom Card</h2>
      </div>

      <form onSubmit={generateCard} className="space-y-8">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-stone-400">Card Title</label>
          <input 
            type="text" 
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., The Beauty of Patience"
            className="w-full bg-stone-50 border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-stone-200 transition-all text-lg"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-stone-400">Topic or Question (AI Prompt)</label>
          <textarea 
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Describe what you want to explore... (This will be used to generate the AI response)"
            className="w-full bg-stone-50 border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-stone-200 transition-all min-h-[120px] text-lg resize-none"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-stone-400">Display Description (Optional)</label>
          <textarea 
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="This text will show up on the card. If empty, the topic above will be used."
            className="w-full bg-stone-50 border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-stone-200 transition-all min-h-[100px] text-lg resize-none"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-stone-400">Attach Image (Optional)</label>
          <div 
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "w-full aspect-video rounded-2xl border-2 border-dashed border-stone-200 flex flex-col items-center justify-center cursor-pointer hover:border-stone-300 hover:bg-stone-50 transition-all overflow-hidden",
              image && "border-solid border-stone-800"
            )}
          >
            {image ? (
              <img src={image} alt="Preview" className="w-full h-full object-cover" />
            ) : (
              <>
                <ImageIcon className="w-10 h-10 text-stone-300 mb-2" />
                <span className="text-stone-400 text-sm">Click to upload an image</span>
              </>
            )}
          </div>
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleImageChange}
            accept="image/*"
            className="hidden"
          />
        </div>

        <div className="pt-4 flex gap-4">
          <button 
            type="button"
            onClick={onCancel}
            className="flex-1 py-4 px-6 rounded-full font-medium text-stone-600 hover:bg-stone-100 transition-colors"
          >
            Cancel
          </button>
          <button 
            type="submit"
            disabled={loading}
            className="flex-[2] py-4 px-6 bg-stone-800 text-stone-50 rounded-full font-medium hover:bg-stone-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating Wisdom...
              </>
            ) : (
              'Generate Card'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function SettingsModal({ 
  onClose, 
  currentProfile, 
  onUpdate 
}: { 
  onClose: () => void, 
  currentProfile: UserProfile | null, 
  onUpdate: (profile: UserProfile) => void 
}) {
  const [imageUrl, setImageUrl] = useState(currentProfile?.globalBackImageUrl || '');
  const [isUpdating, setIsUpdating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    setIsUpdating(true);
    try {
      const profileData = {
        globalBackImageUrl: imageUrl,
        updatedAt: serverTimestamp()
      };
      // Try update first
      await updateDoc(doc(db, 'users', auth.currentUser!.uid), profileData);
      onUpdate(profileData as any);
      onClose();
    } catch (error) {
      // If document doesn't exist, use setDoc instead
      try {
        const profileData = {
          globalBackImageUrl: imageUrl,
          updatedAt: serverTimestamp()
        };
        await setDoc(doc(db, 'users', auth.currentUser!.uid), profileData);
        onUpdate(profileData as any);
        onClose();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'users');
      }
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-stone-900/80 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-[2rem] p-8 max-w-md w-full shadow-2xl border border-stone-200"
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-serif font-bold text-stone-800">Global Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-stone-500" />
          </button>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-stone-400">Global Back Image</label>
            <p className="text-xs text-stone-500 mb-2">This image will appear as the background on the back side of all your cards.</p>
            <div 
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "w-full aspect-video rounded-2xl border-2 border-dashed border-stone-200 flex flex-col items-center justify-center cursor-pointer hover:border-stone-300 hover:bg-stone-50 transition-all overflow-hidden",
                imageUrl && "border-solid border-stone-800"
              )}
            >
              {imageUrl ? (
                <img src={imageUrl} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <>
                  <ImageIcon className="w-10 h-10 text-stone-300 mb-2" />
                  <span className="text-stone-400 text-sm text-center px-4">Click to upload a global background image</span>
                </>
              )}
            </div>
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleImageChange}
              accept="image/*"
              className="hidden"
            />
            {imageUrl && (
              <button 
                onClick={() => setImageUrl('')}
                className="text-xs text-red-500 font-medium hover:underline pt-2"
              >
                Remove image
              </button>
            )}
          </div>

          <button 
            onClick={handleSave}
            disabled={isUpdating}
            className="w-full py-4 bg-stone-800 text-white rounded-full font-medium hover:bg-stone-700 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isUpdating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Settings
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function CardDetail({ card, onBack, isGuestView, globalBackImageUrl }: { card: Flashcard, onBack?: () => void, isGuestView?: boolean, globalBackImageUrl?: string }) {
  const [copied, setCopied] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [followUpQuery, setFollowUpQuery] = useState('');
  const [followUpResponse, setFollowUpResponse] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(card.title);
  const [editTopic, setEditTopic] = useState(card.topic);
  const [editDescription, setEditDescription] = useState(card.description || '');
  const [editImageUrl, setEditImageUrl] = useState(card.imageUrl || '');
  const [editAiResponse, setEditAiResponse] = useState(card.aiResponse);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = auth.currentUser?.email === ADMIN_EMAIL;
  const isOwner = auth.currentUser?.uid === card.authorId;
  const canModify = isAdmin || isOwner;

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditImageUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Reset follow-up state when card changes
  useEffect(() => {
    setIsFlipped(false);
    setFollowUpQuery('');
    setFollowUpResponse('');
    setIsEditing(false);
    setShowDeleteConfirm(false);
    setError(null);
    setEditTitle(card.title);
    setEditTopic(card.topic);
    setEditDescription(card.description || '');
    setEditImageUrl(card.imageUrl || '');
    setEditAiResponse(card.aiResponse);
  }, [card.id, card.title, card.topic, card.description, card.imageUrl, card.aiResponse]);

  const getShareUrl = () => {
    let baseUrl = (window as any).__PUBLIC_SHARE_URL__ || window.location.origin;
    if (baseUrl.includes("-dev-")) {
      baseUrl = baseUrl.replace("-dev-", "-pre-");
    }
    // Force https for sharing to ensure crawlers like WhatsApp can access the metadata
    if (baseUrl.startsWith("http://")) {
      baseUrl = baseUrl.replace("http://", "https://");
    }
    return `${baseUrl}/s/${card.id}`;
  };

  const shareUrl = getShareUrl();

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    setIsUpdating(true);
    setError(null);
    try {
      await deleteDoc(doc(db, 'flashcards', card.id));
      onBack?.();
    } catch (err) {
      console.error("Delete Error:", err);
      setError("Failed to delete the card. Please try again.");
      handleFirestoreError(err, OperationType.DELETE, 'flashcards');
    } finally {
      setIsUpdating(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleUpdate = async (regenerate = false) => {
    if (!editTitle.trim() || !editTopic.trim()) return;
    
    setIsUpdating(true);
    setError(null);
    try {
      let aiResponse = editAiResponse;
      
      if (regenerate) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("API Key is missing.");
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `You are a wise narrator. Provide a concise, gentle, and insightful explanation of the key concepts, references, and stories in the Quran and Hadith on the topic: "${editTopic}". 
  
          Rules for your response:
          1. Use a wise and patient tone.
          2. do NOT address the reader directly.
          3. Focus strictly on the wisdom and knowledge itself.
          4. Whenever you reference or quote from the Quran or Hadith, you MUST:
             - Provide the original Arabic text wrapped in an HTML div with the class "arabic-text".
             - Provide the English translation.
             - Provide the specific reference number.
          5. Use Markdown for formatting.`,
        });
        if (!response.text) {
          const finishReason = response.candidates?.[0]?.finishReason;
          throw new Error(`The wisdom could not be found (Reason: ${finishReason || 'Unknown'}).`);
        }
        aiResponse = response.text;
      }

      await updateDoc(doc(db, 'flashcards', card.id), {
        title: editTitle,
        topic: editTopic,
        description: editDescription || null,
        imageUrl: editImageUrl || null,
        aiResponse,
        boardId: card.boardId || 'default'
      });
      
      setIsEditing(false);
    } catch (err) {
      console.error("Update Error:", err);
      setError("Failed to update the card. Please try again.");
      handleFirestoreError(err, OperationType.UPDATE, 'flashcards');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpQuery.trim() || isGenerating) return;

    setIsGenerating(true);
    setError(null);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("API Key is missing.");

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are a wise narrator. The user is asking a follow-up question about the wisdom you previously shared on the topic "${card.topic}". 
        
        Original Wisdom Shared:
        ${card.aiResponse}

        User's Follow-up Question:
        "${followUpQuery}"

        Rules for your response:
        1. Use a wise and patient tone.
        2. Provide a VERY concise, gentle, and insightful explanation. Your response MUST be brief (maximum 150 words) to ensure it fits perfectly on a single flashcard side without scrolling.
        3. do NOT address the reader directly.
        4. Focus strictly on the wisdom and knowledge itself.
        5. Whenever you reference or quote from the Quran or Hadith, you MUST:
           - Provide the original Arabic text wrapped in an HTML div with the class "arabic-text".
           - Provide the English translation.
           - Provide the specific reference number.
        6. Use Markdown for formatting.`,
      });

      if (!response.text) {
        const finishReason = response.candidates?.[0]?.finishReason;
        throw new Error(`The wisdom could not be found (Reason: ${finishReason || 'Unknown'}).`);
      }

      setFollowUpResponse(response.text);
      setIsFlipped(true);
      setFollowUpQuery('');
    } catch (err) {
      console.error("Follow-up Generation Error:", err);
      setError("I was unable to find further wisdom at this moment. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-12 pb-20">
      {!isGuestView && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-4 justify-end items-center">
            <div className="flex flex-wrap gap-3">
              {canModify && !isEditing && !showDeleteConfirm && (
                <>
                  <button 
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-stone-200 rounded-full text-sm font-medium hover:bg-stone-50 transition-all shadow-sm text-stone-600"
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  <button 
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-red-100 rounded-full text-sm font-medium hover:bg-red-50 transition-all shadow-sm text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </>
              )}
              {showDeleteConfirm && (
                <div className="flex items-center gap-3 bg-red-50 px-4 py-2 rounded-full border border-red-100 animate-in fade-in slide-in-from-right-4">
                  <span className="text-sm font-medium text-red-800">Delete this card?</span>
                  <button 
                    onClick={handleDelete}
                    disabled={isUpdating}
                    className="text-sm font-bold text-red-600 hover:text-red-700 disabled:opacity-50"
                  >
                    Yes, Delete
                  </button>
                  <div className="w-px h-4 bg-red-200" />
                  <button 
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isUpdating}
                    className="text-sm font-medium text-stone-500 hover:text-stone-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {isEditing && (
                <>
                  <button 
                    onClick={() => handleUpdate(false)}
                    disabled={isUpdating}
                    className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-white rounded-full text-sm font-medium hover:bg-stone-700 transition-all shadow-sm disabled:opacity-50"
                  >
                    {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Changes
                  </button>
                  <button 
                    onClick={() => handleUpdate(true)}
                    disabled={isUpdating}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-full text-sm font-medium hover:bg-amber-700 transition-all shadow-sm disabled:opacity-50"
                    title="Update and regenerate AI response"
                  >
                    {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Save & Regenerate
                  </button>
                  <button 
                    onClick={() => setIsEditing(false)}
                    disabled={isUpdating}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-stone-200 rounded-full text-sm font-medium hover:bg-stone-50 transition-all shadow-sm text-stone-600 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                </>
              )}
              {!isEditing && !showDeleteConfirm && (
                <>
                </>
              )}
            </div>
          </div>
          
          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3 text-red-800 text-sm"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <p>{error}</p>
                <button 
                  onClick={() => setError(null)}
                  className="ml-auto p-1 hover:bg-red-100 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="perspective-1000 relative w-full">
        <motion.div 
          animate={{ rotateY: isFlipped ? 180 : 0 }}
          transition={{ duration: 0.6, type: "spring", stiffness: 260, damping: 20 }}
          style={{ transformStyle: "preserve-3d" }}
          className="relative w-full cursor-pointer"
          onClick={() => !isEditing && followUpResponse && setIsFlipped(!isFlipped)}
        >
          {/* Front Side */}
          <div 
            className={cn(
              "relative z-10 backface-hidden rounded-[3rem] overflow-hidden shadow-[0_32px_64px_-12px_rgba(0,0,0,0.3)] border border-stone-800 flex flex-col bg-stone-900 min-h-[700px]",
              isGuestView && "border-white/10"
            )}
            style={{ backfaceVisibility: "hidden" }}
          >
            {/* Navigation Buttons at Top */}
            {!isEditing && (
              <>
                {onBack && (
                  <div className="absolute top-6 left-6 z-20">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onBack();
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-stone-900/60 hover:bg-stone-900/80 rounded-full text-xs font-medium transition-colors border border-white/10 text-white shadow-lg backdrop-blur-md"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Back to Board
                    </button>
                  </div>
                )}
                <div className="absolute top-6 right-6 z-20">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopy();
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-stone-900/60 hover:bg-stone-900/80 rounded-full text-xs font-medium transition-colors border border-white/10 text-white shadow-lg backdrop-blur-md"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Share2 className="w-4 h-4" />}
                    {copied ? 'Link Copied' : 'Share Card'}
                  </button>
                </div>
              </>
            )}

            <div className="relative z-10 p-6 sm:p-12 pt-20 sm:pt-24 flex-1 flex flex-col justify-start overflow-y-auto custom-scrollbar">
              <div className="space-y-8 w-full text-white" onClick={(e) => isEditing && e.stopPropagation()}>
                {isEditing ? (
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-widest text-white/60">Title</label>
                      <input 
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/40 outline-none transition-all"
                        placeholder="Card Title"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-widest text-white/60">Topic (AI Prompt)</label>
                      <textarea 
                        value={editTopic}
                        onChange={(e) => setEditTopic(e.target.value)}
                        className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/40 outline-none transition-all min-h-[100px]"
                        placeholder="Topic for wisdom generation"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-widest text-white/60">Display Description</label>
                      <textarea 
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/40 outline-none transition-all min-h-[100px]"
                        placeholder="Descriptive text for display"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-widest text-white/60">AI Wisdom Answer</label>
                      <textarea 
                        value={editAiResponse}
                        onChange={(e) => setEditAiResponse(e.target.value)}
                        className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/40 outline-none transition-all min-h-[200px] font-mono text-sm"
                        placeholder="The AI generated wisdom"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-widest text-white/60">Card Image</label>
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                          "w-full aspect-video rounded-2xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center cursor-pointer hover:border-white/40 hover:bg-white/5 transition-all overflow-hidden",
                          editImageUrl && "border-solid border-white/40"
                        )}
                      >
                        {editImageUrl ? (
                          <img src={editImageUrl} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <>
                            <ImageIcon className="w-8 h-8 text-white/20 mb-2" />
                            <span className="text-white/40 text-xs">Click to upload a new image</span>
                          </>
                        )}
                      </div>
                      <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleImageChange}
                        accept="image/*"
                        className="hidden"
                      />
                      <div className="flex items-center gap-2 pt-2">
                        <input 
                          type="text"
                          value={editImageUrl}
                          onChange={(e) => setEditImageUrl(e.target.value)}
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[10px] text-white/40 focus:ring-1 focus:ring-white/20 outline-none transition-all"
                          placeholder="Or paste image URL here..."
                        />
                        {editImageUrl && (
                          <button 
                            onClick={() => setEditImageUrl('')}
                            className="p-2 hover:bg-white/10 rounded-lg text-white/40 transition-colors"
                            title="Remove Image"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <h2 className="text-5xl sm:text-7xl font-serif font-bold leading-[1.1] text-white tracking-tight">
                          {card.title}
                        </h2>
                        <p className="text-xl text-white/60 font-light leading-relaxed max-w-2xl">
                          {card.description || card.topic}
                        </p>
                      </div>
                      
                      {(card.imageUrl) && (
                        <div className="w-full aspect-[21/9] overflow-hidden rounded-3xl border border-white/20 shadow-2xl">
                          <img 
                            src={card.imageUrl} 
                            alt={card.title} 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}
                    </div>

                    <div className="w-full h-px bg-white/20" />

                    {/* Chatbox inside the card */}
                    {!isEditing && (
                      <div className="w-full">
                        <form 
                          onSubmit={handleFollowUp}
                          className="relative group"
                        >
                          <input 
                            type="text"
                            value={followUpQuery}
                            onChange={(e) => setFollowUpQuery(e.target.value)}
                            placeholder="Ask a follow-up question about this wisdom..."
                            className="w-full py-4 pl-6 pr-16 bg-stone-900/40 border border-white/20 rounded-2xl shadow-xl backdrop-blur-md focus:ring-2 focus:ring-white/40 focus:border-transparent outline-none transition-all text-white placeholder:text-white/40"
                          />
                          <button 
                            type="submit"
                            disabled={isGenerating || !followUpQuery.trim()}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white text-stone-900 rounded-xl flex items-center justify-center hover:bg-stone-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                          >
                            {isGenerating ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                          </button>
                        </form>
                      </div>
                    )}

                    <div className="space-y-6">
                      {card.aiResponse.split(/(?=^#{1,6}\s)/m).filter(s => s.trim()).map((section, idx) => (
                        <motion.div 
                          key={idx}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          className="relative p-6 rounded-2xl border border-white/20 bg-stone-900/40 backdrop-blur-sm prose prose-invert max-w-none prose-p:text-white prose-p:text-lg prose-headings:text-white prose-headings:font-serif overflow-hidden"
                        >
                          {globalBackImageUrl && (
                            <>
                              <div 
                                className="absolute inset-0 z-0 opacity-20"
                                style={{ 
                                  backgroundImage: `url(${globalBackImageUrl})`,
                                  backgroundSize: 'cover',
                                  backgroundPosition: 'center'
                                }}
                              />
                              <div className="absolute inset-0 z-[1] backdrop-blur-md bg-stone-950/20" />
                            </>
                          )}
                          <div className="relative z-10">
                            <Markdown rehypePlugins={[rehypeRaw]}>{section}</Markdown>
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    <div className="pt-8 flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center bg-white/10 border border-white/10">
                          <BookOpen className="w-6 h-6 text-white" />
                        </div>
                        <p className="text-sm italic text-white/80">
                          A reflection shared through Nur Flashcards.
                        </p>
                      </div>
                      {followUpResponse && (
                        <div className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full text-xs font-medium transition-colors border border-white/10 text-white">
                          <RotateCw className="w-4 h-4" />
                          View Follow-up
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Back Side */}
          <div 
            className={cn(
              "absolute inset-0 backface-hidden rounded-[2.5rem] overflow-hidden shadow-2xl border border-stone-800 flex flex-col bg-stone-900",
              isGuestView && "border-white/10"
            )}
            style={{ 
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)"
            }}
          >
            <div className="relative z-10 p-6 sm:p-12 h-full flex flex-col justify-start">
              <div className="flex justify-between items-center mb-4">
                {onBack && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      onBack();
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-stone-900/60 hover:bg-stone-900/80 rounded-full text-xs font-medium transition-colors border border-white/10 text-white shadow-md backdrop-blur-md"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Board
                  </button>
                )}
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsFlipped(false);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-stone-900/60 hover:bg-stone-900/80 rounded-full text-xs font-medium transition-colors border border-white/10 text-white shadow-md backdrop-blur-md"
                >
                  <RotateCw className="w-4 h-4" />
                  Flip Back to Original
                </button>
              </div>

              <div 
                className="space-y-8 w-full text-white"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <MessageSquare className="w-6 h-6 text-white/60" />
                    <h3 className="text-2xl font-serif font-bold text-white">Follow-up Wisdom</h3>
                  </div>
                </div>

                <div className="w-full h-px bg-white/20" />

                <div className="space-y-6 text-left">
                  {followUpResponse ? (
                    <div className="relative p-6 rounded-2xl border border-white/20 bg-stone-900/40 backdrop-blur-sm prose prose-invert max-w-none prose-p:text-white/90 prose-headings:text-white prose-headings:font-serif overflow-hidden">
                      {globalBackImageUrl && (
                        <>
                          <div 
                            className="absolute inset-0 z-0 opacity-20"
                            style={{ 
                              backgroundImage: `url(${globalBackImageUrl})`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center'
                            }}
                          />
                          <div className="absolute inset-0 z-[1] backdrop-blur-md bg-stone-950/20" />
                        </>
                      )}
                      <div className="relative z-10">
                        <Markdown rehypePlugins={[rehypeRaw]}>{followUpResponse}</Markdown>
                      </div>
                    </div>
                  ) : (
                    <p className="text-white/60 italic text-center">Ask a question below to reveal more wisdom...</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Chatbox removed from bottom */}
    </div>
  );
}
